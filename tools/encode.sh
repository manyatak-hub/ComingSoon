#!/usr/bin/env bash
# encode.sh <framesDir> <out.mp4> <poster.jpg> <crf>
# Turns the recorded frames into a seamless loop: the extra last second fades into the first second.
set -euo pipefail
dir=$1; out=$2; poster=$3; crf=${4:-24}; scale=${5:-}
fps=30
total=$(ls "$dir"/*.jpg | wc -l)
xf=$fps                      # frames in the cross-fade (1 s)
lenA=$((total - xf))         # frames xf..total-1
offset=$(python3 -c "print(($lenA - $xf) / $fps)")
ffmpeg -y -loglevel error \
  -framerate $fps -start_number $xf -i "$dir/%05d.jpg" \
  -framerate $fps -start_number 0 -i "$dir/%05d.jpg" \
  -filter_complex "[1:v]trim=end_frame=$xf,setpts=PTS-STARTPTS[b];[0:v]setpts=PTS-STARTPTS[a];[a][b]xfade=transition=fade:duration=1:offset=$offset${scale:+,scale=$scale:flags=lanczos},format=yuv420p[v]" \
  -map "[v]" -c:v libx264 -preset slow -crf "$crf" -profile:v high -pix_fmt yuv420p -movflags +faststart -an "$out"
# poster: first frame of the loop, small and light
ffmpeg -y -loglevel error -i "$out" -frames:v 1 -q:v 4 "$poster"
ffprobe -v error -show_entries format=duration,size,bit_rate -of default=nw=1 "$out"
