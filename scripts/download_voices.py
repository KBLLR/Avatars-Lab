#!/usr/bin/env python3
import os
import json
import argparse
from pathlib import Path
from huggingface_hub import hf_hub_download

def load_registry(registry_path):
    with open(registry_path, 'r') as f:
        return json.load(f)

def download_voices(registry, output_dir):
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    kokoro_config = registry.get("download_sources", {}).get("kokoro_voices", {})
    repo_id = kokoro_config.get("huggingface")
    subdir = kokoro_config.get("voices_subdir", "voices")
    
    if not repo_id:
        print("Error: No HuggingFace repo specified for Kokoro voices.")
        return

    voices = registry.get("backends", {}).get("kokoro", {}).get("voices", [])
    
    print(f"Checking {len(voices)} voices in {output_path}...")
    
    for voice in voices:
        filename = voice.get("file")
        if not filename:
            continue
            
        file_path = output_path / filename
        if file_path.exists():
            print(f"✓ {voice['name']} ({filename}) already exists")
            continue
            
        print(f"⬇️ Downloading {voice['name']} ({filename})...")
        try:
            hf_hub_download(
                repo_id=repo_id,
                filename=f"{subdir}/{filename}", 
                local_dir=output_dir,
                local_dir_use_symlinks=False
            )
            # Move file if it was downloaded to a subdirectory
            downloaded_path = output_path / subdir / filename
            if downloaded_path.exists():
                downloaded_path.rename(output_path / filename)
                # Clean up empty subdir if possible
                try:
                    (output_path / subdir).rmdir()
                except:
                    pass
                    
            print(f"✅ Downloaded {filename}")
        except Exception as e:
            print(f"❌ Failed to download {filename}: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download TTS voices defined in registry")
    parser.add_argument("--registry", default="../public/voices/registry.json", help="Path to registry.json")
    parser.add_argument("--output", default="../../../model-zoo/mlx/models/voices", help="Output directory for voices")
    
    args = parser.parse_args()
    
    try:
        registry = load_registry(args.registry)
        download_voices(registry, args.output)
    except FileNotFoundError:
        print(f"Error: Registry file not found at {args.registry}")
    except Exception as e:
        print(f"An error occurred: {e}")
