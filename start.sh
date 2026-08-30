#!/usr/bin/env bash
# 百战天元 · 开发服务器启动脚本（含退出清理）
#
# 用法:
#   bash start.sh              启动（前台运行；Ctrl+C 退出并自动释放端口）
#   bash start.sh --no-open    启动但不自动打开浏览器
#   bash start.sh stop         停止正在运行的服务器
#   bash start.sh status       查看运行状态
#   bash start.sh restart      重启（停止旧进程后启动）
set -u
cd "$(dirname "$0")"

PORT=5199
PID_FILE=".qa/dev-server.pid"
LOG_FILE=".qa/dev-server.log"
SERVER_PID=""
OPEN_BROWSER=1

CMD="start"
for arg in "$@"; do
  case "$arg" in
    start|stop|status|restart) CMD="$arg" ;;
    --no-open) OPEN_BROWSER=0 ;;
    *) echo "未知参数: $arg"; sed -n '2,10p' "$0"; exit 1 ;;
  esac
done

# 从 Windows netstat 找到监听端口的进程 PID
port_pid() {
  netstat -ano 2>/dev/null | grep -i tcp | grep -E ":$PORT[[:space:]]" | grep -i listening | awk '{print $NF}' | head -n 1
}

kill_pid_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  taskkill //F //T //PID "$pid" >/dev/null 2>&1 || kill -9 "$pid" 2>/dev/null || true
}

stop() {
  local pid; pid=$(port_pid)
  if [ -z "$pid" ] && [ -f "$PID_FILE" ]; then
    kill_pid_tree "$(cat "$PID_FILE")"
    rm -f "$PID_FILE"
    echo "端口 $PORT 空闲，已清理残留记录。"
    return 0
  fi
  if [ -z "$pid" ]; then
    echo "未发现运行中的服务器（端口 $PORT 空闲）。"
    return 0
  fi
  echo "停止服务器（端口 $PORT，PID $pid）..."
  kill_pid_tree "$pid"
  rm -f "$PID_FILE"
  for _ in $(seq 1 20); do
    [ -z "$(port_pid)" ] && break
    sleep 0.3
  done
  echo "已停止，端口 $PORT 已释放。"
}

status() {
  local pid; pid=$(port_pid)
  if [ -n "$pid" ]; then
    echo "运行中：http://localhost:$PORT（PID $pid）"
  else
    echo "未运行（端口 $PORT 空闲）。"
  fi
}

cleanup() {
  local pid; pid=$(port_pid)
  [ -n "$pid" ] && kill_pid_tree "$pid"
  [ -n "$SERVER_PID" ] && kill_pid_tree "$SERVER_PID"
  rm -f "$PID_FILE"
  echo ""
  echo "已退出，端口 $PORT 已释放。"
}

start() {
  if [ -n "$(port_pid)" ]; then
    echo "端口 $PORT 已有服务器（PID $(port_pid)），先停止旧进程..."
    stop
  fi
  if [ ! -d node_modules ]; then
    echo "首次运行：安装依赖..."
    npm install || { echo "依赖安装失败，请手动执行 npm install。"; exit 1; }
  fi
  mkdir -p .qa
  : > "$LOG_FILE"
  echo "启动开发服务器：http://localhost:$PORT（日志 $LOG_FILE）"
  npm run dev >> "$LOG_FILE" 2>&1 &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$PID_FILE"
  trap cleanup INT TERM EXIT

  local ok=0
  for _ in $(seq 1 60); do
    [ -n "$(port_pid)" ] && { ok=1; break; }
    kill -0 "$SERVER_PID" 2>/dev/null || break
    sleep 0.5
  done
  if [ "$ok" != 1 ]; then
    echo "启动失败，日志末尾："
    tail -n 20 "$LOG_FILE"
    exit 1
  fi

  echo "就绪：http://localhost:$PORT"
  echo "退出方式：按 Ctrl+C（自动停止服务器），或另开终端执行 bash start.sh stop"
  if [ "$OPEN_BROWSER" = 1 ]; then
    explorer.exe "http://localhost:$PORT" >/dev/null 2>&1 || true
  fi
  wait "$SERVER_PID" 2>/dev/null || true
  exit 0
}

case "$CMD" in
  stop) stop ;;
  status) status ;;
  restart) stop; start ;;
  start) start ;;
esac
