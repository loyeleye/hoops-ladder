# Live cues check on recorded clips

Runs recorded front-camera clips through the app's own live-cue code (the `lccore` block of `native-web/native.js`),
to check and tune the Eyes-Up Signals round card: eyes up and glances down, sitting low, base, off arm up, dribble
height, bounce spot, crossover width, pace and lost balls. Not used by the app.

Needs Python with `opencv-python-headless mediapipe onnxruntime numpy`, and Node.

```bash
python pose_clip.py <clip.mp4> <clip>_pose.json ../../www/pose_landmarker_lite.task   # pose at 20 a second, as in the app
python ball_clip.py <clip.mp4> <clip>_ball.json ../../www/ball3f_v2.onnx 0.15        # ball finds, one set per 0.15 s
node eval.mjs <clip>_pose.json <clip>_ball.json [<calls>.json]                       # the round's numbers and glance times
```

The first 2 s of each clip stand in for the setup check's "looking at the phone" calibration.
