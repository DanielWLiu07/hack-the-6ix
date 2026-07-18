#!/usr/bin/env bash
# Hack the 6ix tmux war room. This config uses base-index 1 / pane-base-index 1.
set -e
S=hackathon
R=/Users/danielwliu/Dev/projects/2026/hack-the-6ix

tmux set-option -t $S pane-border-status top
tmux set-option -t $S pane-border-format " #[bold]#{pane_title} "

banner() { # banner <target> <title> <msg>
  tmux select-pane -t "$1" -T "$2"
  tmux send-keys -t "$1" "clear; echo '=== $2 === $3'" C-m
}

haswin() { tmux list-windows -t $S -F '#{window_name}' | grep -qx "$1"; }
nw() { haswin "$1" && tmux kill-window -t "$S:$1"; tmux new-window -t $S -n "$1" -c "$2"; }

tmux rename-window -t $S:1 "master" 2>/dev/null || true

# web
nw web "$R/web"
tmux split-window -t $S:web -h -c "$R/web"
banner "$S:web.1" "web:dev-server" "npm run dev lives here"
banner "$S:web.2" "web:shell" "edit/install/test frontend here"
tmux send-keys -t "$S:web.1" "npm run dev" C-m

# server
nw server "$R/web"
tmux split-window -t $S:server -h -c "$R/web"
banner "$S:server.1" "server:express" "node server/index.js (telemetry hub)"
banner "$S:server.2" "server:test" "curl / wscat testing"

# db
nw db "$R"
tmux split-window -t $S:db -h -c "$R"
banner "$S:db.1" "db:atlas-cli" "atlas auth login -> cluster mgmt"
banner "$S:db.2" "db:mongosh" "query pick_events / telemetry"

# deploy
nw deploy "$R/web"
banner "$S:deploy.1" "deploy:vercel" "vercel --prod from web/"

# firmware: mcu | linux / serial
nw firmware "$R/firmware/mcu"
tmux split-window -t $S:firmware -h -c "$R/firmware/linux"
tmux split-window -t "$S:firmware.2" -v -c "$R/firmware"
banner "$S:firmware.1" "fw:mcu" "STM32 side - motors/servos/e-stop"
banner "$S:firmware.2" "fw:linux" "UNO Q Linux - vision+IK+planner"
banner "$S:firmware.3" "fw:serial" "serial monitor / arduino-cli"

# vision
nw vision "$R/ml/ripeness"
tmux split-window -t $S:vision -h -c "$R/robot/vision"
banner "$S:vision.1" "vision:train" "YOLO ripeness training runs"
banner "$S:vision.2" "vision:infer" "camera pipeline / on-device tests"

# lidar
nw lidar "$R/robot/lidar"
tmux split-window -t $S:lidar -h -c "$R/robot/lidar"
banner "$S:lidar.1" "lidar:pi-ssh" "ssh pi@... - lidar reader"
banner "$S:lidar.2" "lidar:dev" "scan -> websocket -> three.js"

# freesolo
nw freesolo "$R/ml/freesolo-agent"
tmux split-window -t $S:freesolo -h -c "$R/ml/freesolo-agent"
banner "$S:freesolo.1" "llm:train" "Freesolo SFT - FarmHand commander"
banner "$S:freesolo.2" "llm:data" "synthetic command->JSON dataset gen"

tmux select-window -t $S:master
echo "War room ready: master | web | server | db | deploy | firmware | vision | lidar | freesolo"
