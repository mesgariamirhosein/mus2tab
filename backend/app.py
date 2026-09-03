import os
import tempfile
from flask import Flask, request, jsonify
from flask_cors import CORS
from basic_pitch.inference import predict
from basic_pitch import ICASSP_2022_MODEL_PATH

app = Flask(__name__)
CORS(app)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})

@app.route('/analyze', methods=['POST'])
def analyze():
    audio_file = request.files.get('audio') or request.files.get('file')
    if audio_file is None:
        return jsonify({"error": "No audio file provided"}), 400

    suffix = os.path.splitext(audio_file.filename)[-1] or '.mp3'

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        audio_file.save(tmp)
        tmp_path = tmp.name

    try:
        _, _, note_events = predict(tmp_path, ICASSP_2022_MODEL_PATH)

        notes = [
            {
                "onset":    round(float(onset), 4),
                "offset":   round(float(offset), 4),
                "pitch":    int(pitch),
                "velocity": int(velocity),
            }
            for onset, offset, pitch, velocity, *_ in note_events
        ]

        return jsonify({"status": "success", "note_count": len(notes), "notes": notes})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

if __name__ == '__main__':
    app.run(debug=True, port=5000)
