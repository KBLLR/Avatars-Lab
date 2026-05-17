#!/bin/bash
# Adapt SDK avatars using Blender
# Usage: ./adapt_sdk_avatars.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVATARS_DIR="${SCRIPT_DIR}/../../public/avatars"
BLENDER_SCRIPT="${SCRIPT_DIR}/sdk_avatars.py"

# SDK avatars that need adaptation
SDK_AVATARS=("sandri" "nyx" "diego" "anja")

# Try to find Blender executable
BLENDER=""
if command -v blender &> /dev/null; then
    BLENDER="blender"
elif [ -f "/Applications/Blender.app/Contents/MacOS/Blender" ]; then
    BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
elif [ -f "/usr/local/bin/blender" ]; then
    BLENDER="/usr/local/bin/blender"
else
    echo "❌ Blender not found. Please install Blender or add it to your PATH."
    echo "💡 You can download Blender from: https://www.blender.org/download/"
    exit 1
fi

echo "🔧 Found Blender at: $BLENDER"
echo "🎭 Adapting SDK avatars..."

for avatar in "${SDK_AVATARS[@]}"; do
    input_file="${AVATARS_DIR}/${avatar}.glb"
    backup_file="${AVATARS_DIR}/${avatar}_original.glb"

    if [ ! -f "$input_file" ]; then
        echo "⚠️  Skipping $avatar - file not found: $input_file"
        continue
    fi

    echo "🔄 Processing $avatar..."

    # Create backup
    cp "$input_file" "$backup_file"
    echo "📦 Created backup: ${avatar}_original.glb"

    # Process with Blender
    "$BLENDER" --background --python "$BLENDER_SCRIPT" -- "$input_file" 2>/dev/null

    if [ $? -eq 0 ]; then
        echo "✅ Successfully adapted $avatar"
    else
        echo "❌ Failed to adapt $avatar - restoring backup"
        mv "$backup_file" "$input_file"
    fi
done

echo "🎉 SDK avatar adaptation complete!"
echo "💡 Original files are backed up with '_original' suffix"
