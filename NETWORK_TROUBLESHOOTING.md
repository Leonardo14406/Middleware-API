# Network Connectivity Troubleshooting Guide

## Issue Analysis

Based on your error logs, you're experiencing network connectivity issues with Facebook's servers. The specific errors indicate:

- **ETIMEDOUT**: Connection to `157.240.210.35:443` (Facebook IPv4) timed out
- **ENETUNREACH**: IPv6 address `2a03:2880:f150:82:face:b00c:0:25de:443` is unreachable
- **High Latency**: Ping times of 153-227ms indicate slow network connection

## Root Cause

The `facebook-chat-api` library requires stable, low-latency connections to establish persistent sessions with Facebook's chat servers. Your network shows:
- ✅ Basic HTTP connectivity works (curl succeeds)
- ❌ Persistent connections fail due to high latency/timeouts
- ⚠️ IPv6 connectivity issues

## Solutions (Try in Order)

### 1. Immediate Fixes

```bash
# Test current connectivity
node test-facebook-connectivity.js

# Check network performance
ping -c 10 facebook.com
traceroute facebook.com
```

### 2. Network Configuration

**Disable IPv6 (temporary fix):**
```bash
# Add to /etc/sysctl.conf
echo "net.ipv6.conf.all.disable_ipv6 = 1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

**Or use different DNS:**
```bash
# Use Google DNS
sudo systemctl disable systemd-resolved
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
echo "nameserver 8.8.4.4" | sudo tee -a /etc/resolv.conf
```

### 3. Application-Level Solutions

**Increase timeouts in your environment:**
```bash
# Set environment variables
export FACEBOOK_LOGIN_TIMEOUT=90000
export FACEBOOK_RETRY_ATTEMPTS=3
```

**Use mobile hotspot test:**
- Connect to mobile hotspot
- Test Facebook login
- If it works, the issue is your main internet connection

### 4. Alternative Connection Methods

**VPN Solution:**
```bash
# Install and use a VPN
sudo apt install openvpn
# Connect to a server closer to Facebook's data centers (US/EU)
```

**Proxy Configuration:**
```javascript
// Add to facebook login options
const credentials = { 
  email, 
  password,
  userAgent: "Mozilla/5.0 (compatible; ChatBot/1.0)",
  logLevel: "silent"
};
```

### 5. Network Provider Issues

Your high ping times (150-227ms) suggest:
- **ISP routing issues**: Your ISP may have poor routes to Facebook
- **Regional restrictions**: Some regions have limited Facebook access
- **Peak hour congestion**: Network is slow during high usage times

**Solutions:**
- Contact your ISP about Facebook connectivity
- Try during off-peak hours (early morning)
- Consider switching to a different ISP or mobile provider

## Code Improvements Applied

1. **Increased timeouts**: 30s → 60s for login, 20s → 45s for session restore
2. **Retry mechanism**: Automatic retry up to 3 times with exponential backoff
3. **Better error handling**: More specific error messages for network issues
4. **Enhanced connectivity testing**: Improved pre-flight checks

## Monitoring Commands

```bash
# Continuous network monitoring
watch -n 5 'ping -c 1 facebook.com'

# Check if Facebook is down globally
curl -s "https://downdetector.com/status/facebook/"

# Monitor network interface
ifconfig
netstat -i
```

## When to Escalate

If none of these solutions work:
1. **Network Administrator**: If on corporate/shared network
2. **ISP Support**: If using home internet with consistent issues
3. **Facebook Developer Support**: If authentication errors persist
4. **Alternative Services**: Consider using Facebook Graph API instead of chat-api

## Alternative Approach

Consider implementing a fallback mechanism:
- Use Facebook Graph API for basic messaging
- Implement webhooks for incoming messages
- Use official Facebook Business Platform tools

This approach is more reliable for production environments.
