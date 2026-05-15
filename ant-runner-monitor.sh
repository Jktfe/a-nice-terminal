#!/bin/bash

# ANTRUNNER - Agent Status Monitor
# Role: Track and keep momentum in ant delivery chatroom
# Boss: @evolveantclaude

LOG_FILE="/Users/jamesking/CascadeProjects/a-nice-terminal/ant-runner.log"
CHATROOM_ID="bvya907eub7tr0lyup0aro"

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

send_message() {
    local target="$1"
    local message="$2"
    
    log_message "SENDING: $target - $message"
    
    # Send to specific agent or @everyone
    ant chat send "$CHATROOM_ID" --msg "$message" --target "$target"
}

check_agent_status() {
    local agent_id="$1"
    
    # Check if agent has been active in the last 5 minutes
    local last_activity=$(ant chat status "$agent_id" --last-activity)
    
    local last_active=$(echo "$last_activity" | jq -r '.timestamp')
    local current_time=$(date +%s)
    local diff=$((current_time - last_active))
    
    if [ $diff -gt 300 ]; then
        echo "IDLE"
    else
        echo "ACTIVE"
    fi
}

notify_idle_agent() {
    local agent_id="$1"
    
    send_message "$agent_id" "⚠️ @antrunner reminder: You've been idle for 5+ minutes. Check in with @evolveantclaude to stay on track!"
}

notify_everyone() {
    send_message "@everyone" "🔥 @antrunner momentum check: Please ensure all agents are actively contributing. Report to @evolveantclaude if you're blocked!"
}

main() {
    log_message "=== ANTRUNNER CHECK STARTED ==="
    
    # Get list of all agents from chatroom
    local agents=$(ant chat members "$CHATROOM_ID")
    
    local idle_count=0
    
    # Check each agent's status
    for agent_id in $(echo "$agents" | jq -r '.members[].id'); do
        local status=$(check_agent_status "$agent_id")
        
        if [ "$status" == "IDLE" ]; then
            notify_idle_agent "$agent_id"
            ((idle_count++))
        fi
    done
    
    # If 2+ agents are idle, notify everyone
    if [ $idle_count -ge 2 ]; then
        notify_everyone
    fi
    
    log_message "=== ANTRUNNER CHECK COMPLETED (Idle: $idle_count) ==="
}

# Run the check immediately and then every 10 minutes
main

# Set up cron job to run every 10 minutes
echo "Setting up cron job..."
(crontab -l 2>/dev/null; echo "*/10 * * * * /Users/jamesking/CascadeProjects/a-nice-terminal/ant-runner-monitor.sh >> $LOG_FILE 2>&1") | crontab -

echo "✅ ANTRUNNER cron job activated! Checking every 10 minutes."
echo "📋 Boss: @evolveantclaude"
echo "🎯 Role: Track agent status & maintain momentum"
