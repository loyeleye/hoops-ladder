# Ball detector (research, not used by the app yet)

Prototype for checking move type (cross / between / behind) from the ball's path. The app doesn't use it:
held-out move accuracy (15/24) only ties always guessing "between", and the detector has only seen one room and one ball.
Full write-up: project file `hoops-app/ball-detector/results_2026-11-15.md`.

Needs Python with `opencv-python-headless numpy mediapipe torch` (`onnx` and `onnxruntime` for export and speed checks).
Run from a working folder that holds `data/`; set `CLIPS` to the folder with the Move Check Recorder clips and their JSON
call files, and `POSE_MODEL` to `www/pose_landmarker_lite.task`.

| Step | Script | Output |
|---|---|---|
| Decode a clip to 480x270 frames | `decode.py <clip.mp4> <name>` | `data/<name>.npy`, `_t.npy` |
| Learn ball colors from a held-ball frame | `snap.py` (frame and ball position are set inside) | `snap.json` |
| Color + motion candidates (`BALL=dark` for a dark ball) | `track.py <names...>` | `data/<name>_trk.json` |
| Pose per frame | `pose.py <name>` | `data/<name>_pose.json` |
| Keep confident, body-gated, consistent finds as labels (`BALL=dark` also skips the shorts) | `filt.py <names...>` | `data/<name>_lab.json` |
| Train the 3-frame heat-map model | `train.py c01,c02b,c03 60 m1.pt` (v2: `INIT=m1.pt SUB_h01=2 ... train.py c01,...,h03 20 m2.pt`) | weights |
| Run it | `infer.py m1.pt 0.3 det <names...>` | `data/<name>_det.json` |
| Contact sheet for spot checks | `grid.py out.jpg <seed> <name>:<key>...` | image |
| Move check, fixed window (old) / first crossing after each call | `moves.py <key>` / `moves3.py <key> <train,...> <test,...> [-v]` | accuracy |

Model: `model.py`, a small U-Net with depthwise convolutions (120k parameters). Input: 3 frames (t-2, t-1, t),
BGR, scaled 0-1, stacked to 9 channels, 272x480. Output: heat-map logits at half resolution. Trained from scratch;
no third-party weights or datasets.
