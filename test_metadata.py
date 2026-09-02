#!/usr/bin/env python3
"""
Generate synthetic Shairport Sync metadata packets for testing.
This script simulates what Shairport Sync sends when playing music.
"""

import socket
import struct
import time
import base64

def send_metadata(code, data, item_type="ssnc"):
    """Send a metadata packet to the UDP listener."""
    # Shairport format: [type:4][code:4][data:variable]
    packet = item_type.encode() + code.encode() + data
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.sendto(packet, ("127.0.0.1", 5555))
    sock.close()
    print(f"Sent {item_type}/{code}: {len(packet)} bytes")

def test_playback_sequence():
    """Send a complete playback sequence."""
    
    print("Simulating music playback sequence...\n")
    
    # 1. Playback started
    print("1. Playback start")
    send_metadata("prsm", b"")  # Play resume
    time.sleep(0.5)
    
    # 2. Track title
    print("2. Track metadata")
    send_metadata("minm", b"Never Gonna Give You Up")  # Title
    time.sleep(0.1)
    send_metadata("asar", b"Rick Astley")  # Artist
    time.sleep(0.1)
    send_metadata("asal", b"Whenever You Need Somebody")  # Album
    time.sleep(0.1)
    
    # 3. Cover art (using a simple test image - red square)
    print("3. Cover art")
    # Create a tiny 1x1 red JPEG for testing
    # This is a minimal valid JPEG
    jpeg_data = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04\x04\x00\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa\x07"q\x142\x81\x91\xa1\x08#B\xb1\xc1\x15R\xd1\xf0$3br\x82\t\n\x16\x17\x18\x19\x1a%&\'()*456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz\x83\x84\x85\x86\x87\x88\x89\x8a\x92\x93\x94\x95\x96\x97\x98\x99\x9a\xa2\xa3\xa4\xa5\xa6\xa7\xa8\xa9\xaa\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9\xba\xc2\xc3\xc4\xc5\xc6\xc7\xc8\xc9\xca\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9\xda\xe1\xe2\xe3\xe4\xe5\xe6\xe7\xe8\xe9\xea\xf1\xf2\xf3\xf4\xf5\xf6\xf7\xf8\xf9\xfa\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xfb\xd3\xff\xd9'
    send_metadata("PICT", jpeg_data)  # Picture
    time.sleep(0.5)
    
    # 4. Progress updates (simulate playing for 30 seconds)
    print("4. Playing with progress updates...")
    sample_rate = 44100
    start_rtp = 1000000
    end_rtp = start_rtp + (30 * sample_rate)  # 30 second song
    
    for current_progress in range(0, 30, 2):
        current_rtp = start_rtp + (current_progress * sample_rate)
        # Format: "start/current/end"
        progress_data = f"{start_rtp}/{current_rtp}/{end_rtp}".encode()
        send_metadata("prgr", progress_data)
        print(f"   Progress: {current_progress}s / 30s")
        time.sleep(1)
    
    # 5. Pause
    print("5. Pause")
    send_metadata("pfls", b"")  # Pause
    time.sleep(1)
    
    # 6. Resume
    print("6. Resume")
    send_metadata("prsm", b"")  # Play resume
    time.sleep(1)
    
    # 7. End playback
    print("7. Playback end")
    send_metadata("pend", b"")  # Play end
    time.sleep(0.5)
    
    print("\nTest sequence complete!")

if __name__ == "__main__":
    test_playback_sequence()
