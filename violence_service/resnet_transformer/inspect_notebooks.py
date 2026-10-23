import json
import glob

with open('notebook_details.txt', 'w', encoding='utf-8') as out:
    for nb_path in sorted(glob.glob('notebooks/*.ipynb')):
        with open(nb_path, 'r', encoding='utf-8') as f:
            nb = json.load(f)
        out.write(f"\n==================== {nb_path} ====================\n")
        for i, cell in enumerate(nb['cells']):
            if cell.get('cell_type') == 'code':
                src = ''.join(cell.get('source', []))
                if any(k in src.lower() for k in ['load_video_frames', 'videodataset', 'hybridvideoclassifier', 'evaluate_severity_policy', 'threshold']):
                    out.write(f"\n--- Cell {i} ---\n")
                    out.write(src + "\n")
