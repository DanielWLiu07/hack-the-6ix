# vision-train status

## [22:05] WIP — kickoff, env verified, building training pipeline
Python 3.11 + ultralytics 8.3.232 + torch 2.9.1 (MPS GPU available) + onnx/onnxruntime/cv2 all installed.
NO Roboflow/Kaggle credentials found → public-dataset download will be scripted but key-blocked; bootstrapping with a synthetic dataset generator instead (solid-color 3D-printed props make synthetic data highly representative). Plan: classes.json + dataset config → synth generator → train.py/export.py → train v0 → export ONNX+int8.
Need from master (non-blocking): a free Roboflow API key as env ROBOFLOW_API_KEY to also pull real apple/banana photos.
