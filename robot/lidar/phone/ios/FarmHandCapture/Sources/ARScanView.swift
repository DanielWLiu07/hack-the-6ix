// ARScanView - live LiDAR world scanner. Uses ARKit scene reconstruction to
// build the room mesh in real time (wireframe overlay) and streams it to the
// FarmHand laptop (see MeshStreamController) where mesh_receiver.py turns it
// into web/public/world.glb for the dashboard.

import ARKit
import RealityKit
import SwiftUI

struct ARScanView: View {
    @State private var resetToken = 0
    @StateObject private var streamer = MeshStreamController()
    @AppStorage("laptopHost") private var host = "172.20.10.1"

    var supported: Bool { ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) }

    var body: some View {
        ZStack {
            if supported {
                ARMeshContainer(resetToken: resetToken, streamer: streamer)
                    .ignoresSafeArea()
            } else {
                Color.black.ignoresSafeArea()
                Text("This device has no LiDAR scene reconstruction.\nNeeds an iPhone/iPad Pro with LiDAR.")
                    .multilineTextAlignment(.center).foregroundStyle(.red).padding()
            }

            VStack {
                // top status bar
                HStack {
                    Circle().fill(streamer.isStreaming ? .green : .gray)
                        .frame(width: 10, height: 10)
                    Text(streamer.isStreaming ? "STREAMING" : "STANDBY")
                        .font(.footnote.bold()).foregroundStyle(.white)
                    Spacer()
                    Text("\(streamer.anchorsSent) chunks")
                        .font(.system(.footnote, design: .monospaced)).foregroundStyle(.green)
                }
                .padding(12)
                .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal).padding(.top, 8)

                Spacer()

                // controls
                VStack(spacing: 12) {
                    HStack {
                        Text("laptop IP").font(.caption).foregroundStyle(.white.opacity(0.7))
                        TextField("172.20.10.1", text: $host)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.decimalPad)
                            .disabled(streamer.isStreaming)
                    }
                    Text(streamer.statusMessage)
                        .font(.caption2).foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)

                    HStack(spacing: 16) {
                        Button {
                            resetToken += 1
                        } label: {
                            Label("reset", systemImage: "arrow.counterclockwise")
                                .font(.subheadline).padding(.vertical, 12).frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered).tint(.white)

                        Button {
                            streamer.isStreaming ? streamer.stop() : streamer.start(host: host)
                        } label: {
                            Text(streamer.isStreaming ? "Stop" : "Start scan")
                                .font(.headline).padding(.vertical, 12).frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(streamer.isStreaming ? .red : .green)
                        .disabled(!supported)
                    }
                }
                .padding(14)
                .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 18))
                .padding()
            }
        }
        // Keep the screen awake while scanning. Otherwise the display auto-locks,
        // iOS pauses the ARSession, and the mesh stream freezes (looks like it
        // "stops updating" even though the socket is still open).
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            streamer.stop()
        }
        .statusBarHidden()
    }
}

struct ARMeshContainer: UIViewRepresentable {
    let resetToken: Int
    let streamer: MeshStreamController

    func makeUIView(context: Context) -> ARView {
        let view = ARView(frame: .zero)
        view.debugOptions.insert(.showSceneUnderstanding)   // live wireframe mesh
        view.environment.sceneUnderstanding.options = []
        view.session.delegate = context.coordinator
        run(on: view, reset: false)
        context.coordinator.lastToken = resetToken
        return view
    }

    func updateUIView(_ uiView: ARView, context: Context) {
        if context.coordinator.lastToken != resetToken {
            context.coordinator.lastToken = resetToken
            run(on: uiView, reset: true)
        }
    }

    static func dismantleUIView(_ uiView: ARView, coordinator: Coordinator) {
        uiView.session.pause()
    }

    private func run(on view: ARView, reset: Bool) {
        let config = ARWorldTrackingConfiguration()
        config.sceneReconstruction = .mesh
        config.environmentTexturing = .none
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            config.frameSemantics.insert(.sceneDepth)
        }
        // People segmentation: gives a per-frame person mask so we never paint a
        // person's pixels onto the world mesh (stops "friend splatted on table").
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth) {
            config.frameSemantics.insert(.personSegmentationWithDepth)
        }
        view.session.run(config, options: reset ? [.resetTracking, .removeExistingAnchors] : [])
    }

    func makeCoordinator() -> Coordinator { Coordinator(streamer: streamer) }

    final class Coordinator: NSObject, ARSessionDelegate {
        var lastToken = 0
        let streamer: MeshStreamController
        init(streamer: MeshStreamController) { self.streamer = streamer }

        func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
            streamer.handle(anchors: anchors, frame: session.currentFrame)
        }
        func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
            streamer.handle(anchors: anchors, frame: session.currentFrame)
        }
        // Every ARFrame: stream the live camera pose (throttled inside). Mesh
        // anchors only say where the world is; this says where the phone is.
        func session(_ session: ARSession, didUpdate frame: ARFrame) {
            streamer.sendPose(frame: frame)
        }
    }
}
