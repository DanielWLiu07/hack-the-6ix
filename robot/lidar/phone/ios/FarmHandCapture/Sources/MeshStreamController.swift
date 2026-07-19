// MeshStreamController - streams ARKit scene-reconstruction meshes (LiDAR) to
// the FarmHand laptop over TCP so the growing colored 3D world can be watched
// live and turned into world.glb for the dashboard.
//
// Ported/trimmed from the BodyCapture capture-app (whole-scene, no person
// filtering). One frame per mesh-anchor update:
//
//   'MSH2' | uint32 payloadLength | payload
// payload:
//   uuid (16 bytes) | float32 x16 transform (column-major)
//   | uint32 vertexCount | uint32 triangleCount
//   | vertexCount * 3 float32 (anchor-local) | triangleCount * 3 uint32
//   | vertexCount * 3 uint8 RGB (sampled from the camera image)
//
// Camera pose, ~30 Hz on every ARFrame (mesh anchors alone tell the receiver
// where the WALLS are in ARKit world space, but not where the PHONE is - a
// long session's origin can drift kilometers from the device, so any
// "distance ahead" math needs the live egocentric pose):
//
//   'POSE' | uint32 payloadLength (72) | payload
// payload:
//   float64 unix epoch seconds | float32 x16 camera transform (column-major,
//   camera-to-world, same convention as the anchor transform)

import ARKit
import Foundation
import Network

final class MeshStreamController: ObservableObject {
    @Published var isStreaming = false
    @Published var anchorsSent = 0
    @Published var statusMessage = "idle"

    private var connection: NWConnection?
    private let queue = DispatchQueue(label: "farmhand.mesh.net")
    private var lastSent: [UUID: Date] = [:]
    private var lastPoseSent = Date.distantPast
    // Per-voxel color ACCUMULATOR (sumR, sumG, sumB, count) keyed by 1.5cm voxel
    // in anchor-local space - survives ARKit re-meshing AND averages color over
    // many frames so a single bad frame (someone walks by) gets outvoted.
    private var paintGrids: [UUID: [Int64: SIMD4<Float>]] = [:]

    func start(host: String, port: UInt16 = 9353) {
        let nwHost = NWEndpoint.Host(host)
        guard let nwPort = NWEndpoint.Port(rawValue: port) else { return }
        let conn = NWConnection(host: nwHost, port: nwPort, using: .tcp)
        conn.stateUpdateHandler = { [weak self] state in
            DispatchQueue.main.async {
                switch state {
                case .ready:      self?.statusMessage = "connected to \(host):\(port)"
                case .waiting(let e): self?.statusMessage = "waiting: \(e.localizedDescription)"
                case .failed(let e):  self?.statusMessage = "failed: \(e.localizedDescription)"
                case .cancelled:  self?.statusMessage = "stopped"
                default: break
                }
            }
        }
        conn.start(queue: queue)
        connection = conn
        isStreaming = true
        anchorsSent = 0
        statusMessage = "connecting to \(host):\(port)..."
    }

    func stop() {
        connection?.cancel()
        connection = nil
        isStreaming = false
        statusMessage = "stopped"
    }

    /// Stream the live camera pose so the receiver knows where the phone is in
    /// ARKit world space (not just where the mesh is). Called on every ARFrame,
    /// throttled to ~30 Hz; each packet is 84 bytes so bandwidth is negligible.
    func sendPose(frame arFrame: ARFrame) {
        guard isStreaming, let conn = connection else { return }
        let now = Date()
        guard now.timeIntervalSince(lastPoseSent) >= 1.0 / 30.0 else { return }
        lastPoseSent = now
        var payload = Data()
        var ts = now.timeIntervalSince1970
        withUnsafeBytes(of: &ts) { payload.append(contentsOf: $0) }
        var t = arFrame.camera.transform
        withUnsafeBytes(of: &t) { payload.append(contentsOf: $0) }
        var out = Data("POSE".utf8)
        withUnsafeBytes(of: UInt32(payload.count).littleEndian) { out.append(contentsOf: $0) }
        out.append(payload)
        conn.send(content: out, completion: .idempotent)
    }

    func handle(anchors: [ARAnchor], frame arFrame: ARFrame?) {
        guard isStreaming, let conn = connection else { return }
        for anchor in anchors.compactMap({ $0 as? ARMeshAnchor }) {
            let now = Date()
            if let last = lastSent[anchor.identifier], now.timeIntervalSince(last) < 0.7 { continue }
            lastSent[anchor.identifier] = now
            var paint = paintGrids[anchor.identifier] ?? [:]
            let data = serializeAnchor(anchor, frame: arFrame, paintGrid: &paint)
            paintGrids[anchor.identifier] = paint
            conn.send(content: data, completion: .idempotent)
            DispatchQueue.main.async { self.anchorsSent += 1 }
        }
    }

    // MARK: serialization

    private func serializeAnchor(_ anchor: ARMeshAnchor, frame arFrame: ARFrame?,
                                 paintGrid: inout [Int64: SIMD4<Float>]) -> Data {
        let geom = anchor.geometry
        let verts = geom.vertices
        let faces = geom.faces

        let vBase = verts.buffer.contents().advanced(by: verts.offset)
        var localVerts = [simd_float3](repeating: .zero, count: verts.count)
        for i in 0..<verts.count {
            let p = vBase.advanced(by: i * verts.stride).assumingMemoryBound(to: Float.self)
            localVerts[i] = simd_float3(p[0], p[1], p[2])
        }

        let iBase = faces.buffer.contents()
        let idxCount = faces.count * faces.indexCountPerPrimitive
        var indices = [UInt32](repeating: 0, count: idxCount)
        if faces.bytesPerIndex == 4 {
            memcpy(&indices, iBase, idxCount * 4)
        } else {
            let p16 = iBase.assumingMemoryBound(to: UInt16.self)
            for i in 0..<idxCount { indices[i] = UInt32(p16[i]) }
        }

        var colors = [UInt8](repeating: 150, count: verts.count * 3)
        for i in 0..<localVerts.count {
            if let acc = paintGrid[Self.voxelKey(localVerts[i])], acc.w > 0 {
                let inv = 1.0 / acc.w
                colors[i * 3]     = UInt8(max(0, min(255, acc.x * inv)))
                colors[i * 3 + 1] = UInt8(max(0, min(255, acc.y * inv)))
                colors[i * 3 + 2] = UInt8(max(0, min(255, acc.z * inv)))
            }
        }
        if let arFrame {
            Self.sample(colors: &colors, localVerts: localVerts,
                        anchorTransform: anchor.transform, frame: arFrame, paintGrid: &paintGrid)
        }

        var payload = Data()
        withUnsafeBytes(of: anchor.identifier.uuid) { payload.append(contentsOf: $0) }
        var t = anchor.transform
        withUnsafeBytes(of: &t) { payload.append(contentsOf: $0) }
        withUnsafeBytes(of: UInt32(localVerts.count).littleEndian) { payload.append(contentsOf: $0) }
        withUnsafeBytes(of: UInt32(indices.count / 3).littleEndian) { payload.append(contentsOf: $0) }
        var packed = [Float](repeating: 0, count: localVerts.count * 3)
        for i in 0..<localVerts.count {
            packed[i * 3] = localVerts[i].x
            packed[i * 3 + 1] = localVerts[i].y
            packed[i * 3 + 2] = localVerts[i].z
        }
        packed.withUnsafeBytes { payload.append(contentsOf: $0) }
        indices.withUnsafeBytes { payload.append(contentsOf: $0) }
        payload.append(contentsOf: colors)

        var out = Data("MSH2".utf8)
        withUnsafeBytes(of: UInt32(payload.count).littleEndian) { out.append(contentsOf: $0) }
        out.append(payload)
        return out
    }

    /// 1.5cm voxel key in anchor-local space (21 bits per axis) - finer = sharper
    /// per-vertex color (was 4cm, which read as blocky).
    private static func voxelKey(_ p: simd_float3) -> Int64 {
        let q: Float = 0.015
        let x = Int64((p.x / q).rounded(.down)) & 0x1F_FFFF
        let y = Int64((p.y / q).rounded(.down)) & 0x1F_FFFF
        let z = Int64((p.z / q).rounded(.down)) & 0x1F_FFFF
        return x | (y << 21) | (z << 42)
    }

    /// Project each vertex into the camera image, sample color (YCbCr -> RGB),
    /// cache by voxel so colors persist across re-meshing.
    private static func sample(colors: inout [UInt8], localVerts: [simd_float3],
                               anchorTransform: simd_float4x4, frame: ARFrame,
                               paintGrid: inout [Int64: SIMD4<Float>]) {
        let pb = frame.capturedImage
        guard CVPixelBufferGetPlaneCount(pb) >= 2 else { return }
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }

        let w = CVPixelBufferGetWidthOfPlane(pb, 0)
        let h = CVPixelBufferGetHeightOfPlane(pb, 0)
        guard let yBaseRaw = CVPixelBufferGetBaseAddressOfPlane(pb, 0),
              let cBaseRaw = CVPixelBufferGetBaseAddressOfPlane(pb, 1) else { return }
        let yBase = yBaseRaw.assumingMemoryBound(to: UInt8.self)
        let cBase = cBaseRaw.assumingMemoryBound(to: UInt8.self)
        let yStride = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
        let cStride = CVPixelBufferGetBytesPerRowOfPlane(pb, 1)

        let camera = frame.camera
        let viewport = CGSize(width: w, height: h)

        // LiDAR depth, aligned to the captured image, for an occlusion test.
        // Without it, a table vertex BEHIND a person still samples the person's
        // pixel -> the person gets "splatted flat" onto the table/wall. We skip
        // any vertex that sits well behind the nearest measured surface.
        let depthMap = frame.sceneDepth?.depthMap
        var dBase: UnsafePointer<Float32>? = nil
        var dW = 0, dH = 0, dRowFloats = 0
        if let dm = depthMap {
            CVPixelBufferLockBaseAddress(dm, .readOnly)
            dW = CVPixelBufferGetWidth(dm)
            dH = CVPixelBufferGetHeight(dm)
            dRowFloats = CVPixelBufferGetBytesPerRow(dm) / 4
            if let base = CVPixelBufferGetBaseAddress(dm) {
                dBase = UnsafePointer(base.assumingMemoryBound(to: Float32.self))
            }
        }
        defer { if let dm = depthMap { CVPixelBufferUnlockBaseAddress(dm, .readOnly) } }

        // Per-pixel depth CONFIDENCE (0/1/2). Reject the lowest so noisy, bleedy
        // samples (edges, dark/shiny surfaces) don't get painted.
        let confMap = frame.sceneDepth?.confidenceMap
        var cfBase: UnsafePointer<UInt8>? = nil
        var cfRow = 0
        if let cf = confMap {
            CVPixelBufferLockBaseAddress(cf, .readOnly)
            cfRow = CVPixelBufferGetBytesPerRow(cf)
            if let base = CVPixelBufferGetBaseAddress(cf) {
                cfBase = UnsafePointer(base.assumingMemoryBound(to: UInt8.self))
            }
        }
        defer { if let cf = confMap { CVPixelBufferUnlockBaseAddress(cf, .readOnly) } }

        // Person MASK: never paint a person's pixels onto the world mesh.
        let segMap = frame.segmentationBuffer
        var sBase: UnsafePointer<UInt8>? = nil
        var sW = 0, sH = 0, sRow = 0
        if let sm = segMap {
            CVPixelBufferLockBaseAddress(sm, .readOnly)
            sW = CVPixelBufferGetWidth(sm); sH = CVPixelBufferGetHeight(sm)
            sRow = CVPixelBufferGetBytesPerRow(sm)
            if let base = CVPixelBufferGetBaseAddress(sm) {
                sBase = UnsafePointer(base.assumingMemoryBound(to: UInt8.self))
            }
        }
        defer { if let sm = segMap { CVPixelBufferUnlockBaseAddress(sm, .readOnly) } }

        for i in 0..<localVerts.count {
            let world4 = anchorTransform * simd_float4(localVerts[i], 1)
            let camSpace = camera.transform.inverse * world4
            guard camSpace.z < -0.05 else { continue }   // behind camera
            let pt = camera.projectPoint(simd_float3(world4.x, world4.y, world4.z),
                                         orientation: .landscapeRight, viewportSize: viewport)
            let px = Int(pt.x), py = Int(pt.y)
            guard px >= 0, px < w, py >= 0, py < h else { continue }

            let vDepth = -camSpace.z
            if dW > 0, dH > 0 {
                let ddx = min(dW - 1, max(0, px * dW / w))
                let ddy = min(dH - 1, max(0, py * dH / h))
                if let db = dBase {
                    let measured = db[ddy * dRowFloats + ddx]
                    // occlusion: skip vertices behind the nearest surface
                    if measured > 0.05 && vDepth > measured + 0.12 { continue }
                    // depth-edge: skip near discontinuities (foreground color bleeds here)
                    let xm = max(0, ddx - 1), xp = min(dW - 1, ddx + 1)
                    let ym = max(0, ddy - 1), yp = min(dH - 1, ddy + 1)
                    let d0 = db[ddy * dRowFloats + xm], d1 = db[ddy * dRowFloats + xp]
                    let d2 = db[ym * dRowFloats + ddx], d3 = db[yp * dRowFloats + ddx]
                    let mn = min(min(d0, d1), min(d2, d3)), mx = max(max(d0, d1), max(d2, d3))
                    if mx - mn > 0.10 { continue }
                }
                // depth confidence: reject the lowest tier
                if let cf = cfBase, cf[ddy * cfRow + ddx] < 1 { continue }
            }

            // person mask: skip pixels that belong to a person
            if let sb = sBase, sW > 0, sH > 0 {
                let sx = min(sW - 1, max(0, px * sW / w))
                let sy = min(sH - 1, max(0, py * sH / h))
                if sb[sy * sRow + sx] > 127 { continue }
            }

            let yv = Float(yBase[py * yStride + px])
            let ci = (py / 2) * cStride + (px / 2) * 2
            let cb = Float(cBase[ci]) - 128
            let cr = Float(cBase[ci + 1]) - 128
            let r = max(0, min(255, yv + 1.402 * cr))
            let g = max(0, min(255, yv - 0.344 * cb - 0.714 * cr))
            let b = max(0, min(255, yv + 1.772 * cb))

            // running average per voxel (soft-capped) - one bad frame gets outvoted
            let key = voxelKey(localVerts[i])
            var acc = paintGrid[key] ?? SIMD4<Float>(0, 0, 0, 0)
            if acc.w >= 24 { acc *= 0.75 }
            acc += SIMD4<Float>(r, g, b, 1)
            paintGrid[key] = acc
            let inv = 1.0 / acc.w
            colors[i * 3]     = UInt8(max(0, min(255, acc.x * inv)))
            colors[i * 3 + 1] = UInt8(max(0, min(255, acc.y * inv)))
            colors[i * 3 + 2] = UInt8(max(0, min(255, acc.z * inv)))
        }
    }
}
