#!/usr/bin/env python3
"""
SubsPipeline — Transcription engine with word-level timestamps,
lipsync mode support, real-time progress logging, and ASS styling effects (social media templates).
"""

import sys
import json
import os


def format_ts_srt(seconds):
    """Format seconds to SRT timestamp: HH:MM:SS,mmm"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def format_ts_ass(seconds):
    """Format seconds to ASS timestamp: H:MM:SS.cc"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


def hex_to_ass_color(hex_color):
    """Convert #RRGGBB to ASS &H00BBGGRR format."""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) != 6:
        hex_color = 'FFFFFF'
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return f"&H00{b:02X}{g:02X}{r:02X}"


def emit(obj):
    """Emit a JSON line to stdout for the Node.js wrapper."""
    print(json.dumps(obj), flush=True)


def generate_srt(segments, output_path):
    """Write segments to an SRT subtitle file."""
    with open(output_path, 'w', encoding='utf-8') as f:
        for i, seg in enumerate(segments, 1):
            f.write(f"{i}\n")
            f.write(f"{format_ts_srt(seg['start'])} --> {format_ts_srt(seg['end'])}\n")
            text = seg['text'].strip()
            f.write(f"{text}\n\n")


def chunk_text(text, max_lines):
    """
    Simulate wrapping for ASS subtitles based on max_lines.
    """
    words = text.split()
    if not words or max_lines <= 1:
        return text

    total_words = len(words)
    chunk_size = max(1, -(-total_words // max_lines)) # ceil division
    chunks = [words[i:i + chunk_size] for i in range(0, total_words, chunk_size)]
    return '\\N'.join([' '.join(c) for c in chunks])


def apply_ass_effect(text, effect, duration_ms):
    """
    Apply advanced ASS tags to create popular social media text effects.
    duration_ms is the duration of the dialogue block in milliseconds.
    """
    if not effect or effect == 'none':
        return text

    # Convert to standard animation timings
    mid_in = min(200, int(duration_ms * 0.2))
    out_start = max(mid_in, int(duration_ms * 0.85))
    out_dur = int(duration_ms - out_start)

    if effect == 'pop':
        # Scale pop/bounce effect: start small (80%), expand to (110%), settle to (100%)
        return f"{{\\fscx80\\fscy80\\t(0,80,\\fscx115\\fscy115)\\t(80,150,\\fscx100\\fscy100)}}{text}"
        
    elif effect == 'fade':
        # Simple fade in and out tag: \fad(fade_in_ms, fade_out_ms)
        return f"{{\\fad(150,150)}}{text}"
        
    elif effect == 'slide':
        # Slide up effect: shift position slightly on Y axis at the start
        # ASS clip translation isn't trivial without absolute positions,
        # so we use a small font size transition or spacing transition as a fallback.
        return f"{{\\fsp-3\\t(0,180,\\fsp0)}}{text}"
        
    elif effect == 'shake':
        # Rapid vibration using transient transform
        t1 = int(duration_ms * 0.2)
        t2 = int(duration_ms * 0.4)
        t3 = int(duration_ms * 0.6)
        t4 = int(duration_ms * 0.8)
        return f"{{\\frz-2\\t(0,{t1},\\frz2)\\t({t1},{t2},\\frz-2)\\t({t2},{t3},\\frz2)\\t({t3},{t4},\\frz0)}}{text}"
        
    elif effect == 'glow':
        # Temporarily increase border/outline size to create a glow puff
        return f"{{\\xbord4\\ybord4\\t(0,150,\\xbord2\\ybord2)}}{text}"

    return text


def generate_ass(segments, output_path, template):
    """Write segments to an ASS subtitle file with custom styling and animations."""
    font = template.get('fontFamily', 'Arial')
    size = template.get('fontSize', 24)
    primary = hex_to_ass_color(template.get('fontColor', '#FFFFFF'))
    outline = hex_to_ass_color(template.get('outlineColor', '#000000'))
    outline_w = template.get('outlineWidth', 2)
    
    # Custom vertical positioning (0-100%)
    vert_pos = template.get('verticalPosition', 10)
    margin_v = int((vert_pos / 100) * 1080)
    if margin_v < 10:
        margin_v = 10

    alignment = 2
    max_lines = template.get('maxLines', 1)
    mode = template.get('mode', 'normal')
    effect = template.get('effect', 'none')

    header = (
        "[Script Info]\n"
        "Title: SubsPipeline Auto-Generated Subtitles\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1920\n"
        "PlayResY: 1080\n"
        "WrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{font},{size},{primary},&H000000FF,{outline},"
        f"&H80000000,0,0,0,0,100,100,0,0,1,{outline_w},0,"
        f"{alignment},20,20,{margin_v},1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, "
        "Effect, Text\n"
    )

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(header)
        for seg in segments:
            start = format_ts_ass(seg['start'])
            end = format_ts_ass(seg['end'])
            text = seg['text'].strip()
            
            # Dialogue block duration in milliseconds
            dur_ms = int((seg['end'] - seg['start']) * 1000)
            
            # Apply wrap if normal mode
            if mode != 'lipsync':
                text = chunk_text(text, max_lines)
            else:
                text = text.replace('\n', ' ')

            # Apply ASS styling animations
            text = apply_ass_effect(text, effect, dur_ms)

            f.write(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}\n")


def main():
    if len(sys.argv) < 7:
        emit({
            "error": "Usage: transcribe.py <audio> <model> <lang|auto> "
                     "<out_srt> <out_ass> '<template_json>'"
        })
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2]
    language = sys.argv[3] if sys.argv[3] != 'auto' else None
    output_srt = sys.argv[4]
    output_ass = sys.argv[5]

    try:
        template = json.loads(sys.argv[6])
    except json.JSONDecodeError:
        template = {}

    if not os.path.isfile(audio_path):
        emit({"error": f"Audio file not found: {audio_path}"})
        sys.exit(1)

    # --- Load model ---
    emit({"status": "loading_model", "model": model_size})

    from faster_whisper import WhisperModel
    model = WhisperModel(
        model_size,
        device="cpu",
        compute_type="int8"
    )

    # --- Transcribe ---
    emit({"status": "transcribing", "file": os.path.basename(audio_path)})

    mode = template.get('mode', 'lipsync')
    word_timestamps = True

    segments_gen, info = model.transcribe(
        audio_path,
        language=language,
        beam_size=5,
        word_timestamps=word_timestamps,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500)
    )

    raw_segments = []
    duration = info.duration if info.duration > 0 else 1.0

    # Read generator to get segment list and emit progress
    for seg in segments_gen:
        pct = min(99, int((seg.end / duration) * 100))
        emit({
            "status": "progress",
            "percent": pct,
            "current_time": round(seg.end, 1),
            "total_time": round(duration, 1)
        })
        
        words_list = []
        if seg.words:
            for w in seg.words:
                words_list.append({
                    "start": w.start,
                    "end": w.end,
                    "word": w.word
                })

        raw_segments.append({
            "start": seg.start,
            "end": seg.end,
            "text": seg.text,
            "words": words_list
        })

    emit({
        "status": "generating_subtitles",
        "segments_count": len(raw_segments),
        "language": info.language,
        "duration": round(duration, 2)
    })

    # Prepare final subtitle list according to Mode
    processed_subtitles = []
    
    if mode == 'lipsync':
        # Lipsync: Single word at a time
        for seg in raw_segments:
            if seg['words']:
                for w in seg['words']:
                    word_text = w['word'].strip()
                    if word_text:
                        processed_subtitles.append({
                            "start": w['start'],
                            "end": w['end'],
                            "text": word_text
                        })
            else:
                words = seg['text'].strip().split()
                if words:
                    chunk_dur = (seg['end'] - seg['start']) / len(words)
                    for idx, word in enumerate(words):
                        processed_subtitles.append({
                            "start": seg['start'] + idx * chunk_dur,
                            "end": seg['start'] + (idx + 1) * chunk_dur,
                            "text": word
                        })
    else:
        # Normal segment mode
        for seg in raw_segments:
            processed_subtitles.append({
                "start": seg['start'],
                "end": seg['end'],
                "text": seg['text']
            })

    # --- Generate output files ---
    generate_srt(processed_subtitles, output_srt)
    generate_ass(processed_subtitles, output_ass, template)

    # --- Done ---
    emit({
        "status": "done",
        "srt_path": output_srt,
        "ass_path": output_ass,
        "language": info.language,
        "duration": round(duration, 2),
        "segments_count": len(processed_subtitles)
    })


if __name__ == '__main__':
    main()
