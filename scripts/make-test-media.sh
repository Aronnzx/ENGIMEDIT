#!/usr/bin/env bash
# Rigenera i video di prova usati dai test (richiede ffmpeg con libx264, libvpx e libopus).
set -euo pipefail
cd "$(dirname "$0")/../testmedia"
ffmpeg -v error -y -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 6 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest Paesaggio.mp4
ffmpeg -v error -y -f lavfi -i "testsrc=size=720x1280:rate=30" -f lavfi -i "sine=frequency=660:sample_rate=48000" -t 5 -c:v libx264 -pix_fmt yuv420p -g 30 -c:a aac -shortest Verticale.mp4
ffmpeg -v error -y -f lavfi -i "smptebars=size=640x360:rate=25" -f lavfi -i "sine=frequency=330:sample_rate=48000" -t 4 -c:v libvpx-vp9 -b:v 600k -c:a libopus -shortest Barre.webm
ffmpeg -v error -y -f lavfi -i "mandelbrot=size=640x360:rate=30" -t 3 -c:v libx264 -pix_fmt yuv420p -an Muto.mp4
# Video "contatore": luminosità = 4 × numero del fotogramma, per verificare l'esportazione fotogramma per fotogramma
ffmpeg -v error -y -f lavfi -i "nullsrc=size=320x240:rate=30,format=gray,geq=lum='mod(N*4\,256)'" -t 4 -c:v libx264 -pix_fmt yuv420p -qp 0 -g 60 Contatore.mp4
ffmpeg -v error -y -f lavfi -i "nullsrc=size=640x480:rate=30,format=gray,geq=lum='mod(N*4\,256)'" -t 6 -c:v libx264 -pix_fmt yuv420p -crf 12 -bf 3 Conta30.mp4
ffmpeg -v error -y -f lavfi -i "nullsrc=size=640x480:rate=25,format=gray,geq=lum='mod(N*4\,256)'" -t 6 -c:v libx264 -pix_fmt yuv420p -crf 12 -bf 3 -g 250 Conta25.mp4
ffmpeg -v error -y -f lavfi -i "nullsrc=size=640x480:rate=30,format=gray,geq=lum='mod(N*4\,256)'" -t 4 -c:v libvpx-vp9 -crf 10 -b:v 0 -g 120 Conta30.webm
# Immagine e audio per Media Pool, traccia V2 e traccia A1
ffmpeg -v error -y -f lavfi -i "testsrc2=size=800x600:rate=1" -frames:v 1 Foto.png
ffmpeg -v error -y -f lavfi -i "sine=frequency=440:duration=8:sample_rate=44100" -af "volume=0.6" -ac 2 -b:a 128k Musica.mp3
ffmpeg -v error -y -f lavfi -i "sine=frequency=660:duration=3" -ac 1 Voce.wav
head -c 200000 /dev/urandom > Rotto.mp4      # file danneggiato
echo "ciao" > appunti.txt                    # file che non è un video
echo "Video di prova rigenerati in testmedia/"
