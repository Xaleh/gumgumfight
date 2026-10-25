#!/bin/bash
# sheet.sh <video> t1 t2 ... : quadros do mp4 final lado a lado
v=$1; shift; args=(); f=""; i=0
for t in "$@"; do ffmpeg -v error -y -ss $t -i final/$v.mp4 -frames:v 1 -vf scale=300:-1 out/$v/s_$i.png; args+=(-i out/$v/s_$i.png); i=$((i+1)); done
ffmpeg -v error -y "${args[@]}" -filter_complex "hstack=$i" out/$v/sheet.png
