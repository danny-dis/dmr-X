#!/usr/bin/env python3
"""
Seed provider keys from .env into the DMR-X gateway provider_keys table.
Uses the admin API endpoint: PUT /v1/admin/providers/<UUID>/api-key
"""
import json
import os
import subprocess
import sys
import time

GATEWAY_URL = "http://127.0.0.1:47113"

def get_provider_uuids():
    """Get all providers and their UUIDs from the admin API."""
    result = subprocess.run(
        ["curl", "-s", "-m5", f"{GATEWAY_URL}/v1/admin/providers"],
        capture_output=True, text=True
    )
    data = json.loads(result.stdout)
    providers = data if isinstance(data, list) else data.get("data", data.get("providers", []))
    return {p["name"]: p["id"] for p in providers}

def get_env_keys(env_path):
    """Extract key-value pairs from .env file."""
    keys = {}
    with open(env_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, value = line.split("=", 1)
                keys[key.strip()] = value.strip()
    return keys

def seed_key(provider_uuid, api_key, tier="paid"):
    """Seed a provider key via the admin API."""
    payload = json.dumps({"api_key": api_key, "tier": tier})
    result = subprocess.run(
        [
            "curl", "-s", "-m10", "-X", "PUT",
            f"{GATEWAY_URL}/v1/admin/providers/{provider_uuid}/api-key",
            "-H", "Content-Type: application/json",
            "-d", payload
        ],
        capture_output=True, text=True
    )
    return result.stdout

def main():
    env_path = r"C:\Users\pc\Documents\projects\DMR-X\.env"
    
    # Map env vars to provider names and tiers
    env_to_provider = {
        "GOOGLE_API_KEY": ("google", "paid"),
        "MISTRAL_API_KEY": ("mistral", "paid"),
        "COHERE_API_KEY": ("cohere", "paid"),
        "NVIDIA_NIM_API_KEY": ("nvidia-nim", "paid"),
        "CODESTRAL_API_KEY": ("codestral-free", "free"),
        "OPENCODE_ZEN_API_KEY": ("opencode-zen", "paid"),
        "GITLAWB_API_KEY": ("gitlawb", "paid"),
        "OPENROUTER_API_KEY": ("openrouter-free", "free"),
    }
    
    print("Fetching provider UUIDs...")
    provider_uuids = get_provider_uuids()
    print(f"Found {len(provider_uuids)} providers")
    
    env_keys = get_env_keys(env_path)
    print(f"Found {len(env_keys)} env vars")
    
    seeded = 0
    skipped = 0
    errors = 0
    
    for env_var, (provider_name, tier) in env_to_provider.items():
        if env_var not in env_keys:
            print(f"  SKIP {env_var}: not in .env")
            skipped += 1
            continue
        
        if provider_name not in provider_uuids:
            print(f"  SKIP {provider_name}: not found in DB")
            skipped += 1
            continue
        
        api_key = env_keys[env_var]
        uuid = provider_uuids[provider_name]
        
        print(f"  Seeding {provider_name} ({uuid[:11]}) tier={tier}...", end=" ")
        response = seed_key(uuid, api_key, tier)
        
        try:
            result = json.loads(response)
            if "error" in result:
                print(f"ERROR: {result['error']}")
                errors += 1
            else:
                print("OK")
                seeded += 1
        except json.JSONDecodeError:
            print(f"RESPONSE: {response[:100]}")
            errors += 1
        
        time.sleep(0.5)  # Rate limit
    
    print(f"\nDone: {seeded} seeded, {skipped} skipped, {errors} errors")

if __name__ == "__main__":
    main()
