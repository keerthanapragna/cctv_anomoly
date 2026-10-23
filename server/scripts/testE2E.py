import base64
import json
import requests
import numpy as np
import cv2

frames = []
for i in range(16):
    img = np.full((224, 224, 3), fill_value=(i * 12) % 256, dtype=np.uint8)
    _, buf = cv2.imencode('.jpg', img)
    frames.append('data:image/jpeg;base64,' + base64.b64encode(buf).decode('utf-8'))

# Set low threshold so it qualifies as suspected incident and triggers database persistence logic
payload = {
    'frames': frames,
    'threshold': 0.05,
    'cameraId': 'CAM-WEBCAM-ALERT-TEST',
    'source': 'webcam'
}

print('Sending 16 frames with threshold=0.05 to trigger qualifying alert evaluation...')
res = requests.post('http://localhost:5000/api/v1/violence/analyze-frames', json=payload, timeout=30)
print('Response status:', res.status_code)
print('Response JSON:', json.dumps(res.json(), indent=2))
