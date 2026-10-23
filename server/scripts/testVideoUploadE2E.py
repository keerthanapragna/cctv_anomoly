import os
import tempfile
import requests
import json
import cv2
import numpy as np

# Create a temporary synthetic mp4 video
temp_dir = tempfile.mkdtemp()
video_path = os.path.join(temp_dir, 'synthetic_test.mp4')

w, h = 224, 224
fourcc = cv2.VideoWriter_fourcc(*'mp4v')
out = cv2.VideoWriter(video_path, fourcc, 10.0, (w, h))
for i in range(20):
    frame = np.full((h, w, 3), fill_value=((i * 25) % 256), dtype=np.uint8)
    out.write(frame)
out.release()

print(f'Created synthetic video at {video_path} (size: {os.path.getsize(video_path)} bytes)')

try:
    with open(video_path, 'rb') as f:
        files = {'file': ('synthetic_test.mp4', f, 'video/mp4')}
        data = {'cameraId': 'CAM-VIDEO-TEST', 'threshold': '0.65'}
        print('Sending video upload to Express http://localhost:5000/api/v1/violence/analyze-video...')
        res = requests.post(
            'http://localhost:5000/api/v1/violence/analyze-video',
            files=files,
            data=data,
            timeout=60,
        )
        print('Response status:', res.status_code)
        print('Response JSON:', json.dumps(res.json(), indent=2))
finally:
    if os.path.exists(video_path):
        os.remove(video_path)
    if os.path.exists(temp_dir):
        os.rmdir(temp_dir)
