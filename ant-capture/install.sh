#!/usr/bin/env bash
# ANT capture hook installer
set -e
HOOK_DIR="$HOME/.ant/hooks"
mkdir -p "$HOOK_DIR"
cp "$(dirname "$0")/ant.zsh" "$HOOK_DIR/ant.zsh"
cp "$(dirname "$0")/ant.bash" "$HOOK_DIR/ant.bash"
cp "$(dirname "$0")/ant-capture" "$HOOK_DIR/ant-capture"
chmod +x "$HOOK_DIR/ant-capture"

# Add to ~/.zshrc if not already there
ZSHRC="$HOME/.zshrc"
ZSH_LINE='[ -f "$HOME/.ant/hooks/ant.zsh" ] && source "$HOME/.ant/hooks/ant.zsh"'
if ! grep -qF 'ant/hooks/ant.zsh' "$ZSHRC" 2>/dev/null; then
  echo "" >> "$ZSHRC"
  echo "# ANT shell capture hooks" >> "$ZSHRC"
  echo "$ZSH_LINE" >> "$ZSHRC"
  echo "Installed ANT hooks into $ZSHRC"
else
  echo "ANT hooks already in $ZSHRC"
fi
echo "Done. Restart your shell or run: source ~/.zshrc"
