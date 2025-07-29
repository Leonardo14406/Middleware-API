# Facebook Service Troubleshooting Guide

## Common Connection Error (ETIMEDOUT / ENETUNREACH)

The error you encountered is a **network connectivity issue** where the facebook-chat-api cannot connect to Facebook's servers. This is a common problem with several possible causes and solutions.

### Error Details
```
Error: connect ETIMEDOUT 157.240.210.35:443
Error: connect ENETUNREACH 2a03:2880:f150:82:face:b00c:0:25de:443
```

This indicates:
- `ETIMEDOUT`: Connection attempt timed out
- `ENETUNREACH`: Network is unreachable (IPv6 issue)
- `157.240.210.35`: Facebook server IP address
- `443`: HTTPS port

## Possible Causes & Solutions

### 1. **Network Connectivity Issues** ⭐ Most Common
**Symptoms:** Cannot reach Facebook servers
**Solutions:**
```bash
# Test basic connectivity
ping facebook.com
curl -I https://www.facebook.com

# Check DNS resolution
nslookup facebook.com
```

### 2. **Firewall/Proxy Blocking**
**Symptoms:** Specific ports or domains blocked
**Solutions:**
- Check if port 443 (HTTPS) is open
- Whitelist Facebook domains in firewall
- Configure proxy settings if needed

### 3. **Regional/ISP Blocking** 
**Symptoms:** Facebook access restricted in your region/network
**Solutions:**
- Try using a VPN
- Contact your ISP
- Use mobile hotspot to test

### 4. **IPv6 Connectivity Issues**
**Symptoms:** IPv6 address unreachable
**Solutions:**
```bash
# Disable IPv6 temporarily (Linux)
sudo sysctl -w net.ipv6.conf.all.disable_ipv6=1

# Or force IPv4 only in Node.js
export NODE_OPTIONS="--dns-result-order=ipv4first"
```

### 5. **Facebook Server Issues**
**Symptoms:** Temporary Facebook outages
**Solutions:**
- Check Facebook status: https://downdetector.com/status/facebook/
- Wait and retry later
- Monitor Facebook developer announcements

## Quick Fixes to Try

### 1. **Test Connectivity First**
```javascript
import { testFacebookConnectivity } from './facebookService.js';

const isConnected = await testFacebookConnectivity();
console.log('Facebook reachable:', isConnected);
```

### 2. **Network Diagnostics**
```bash
# Check if Facebook is reachable
curl -v --connect-timeout 10 https://www.facebook.com

# Test different DNS servers
dig @8.8.8.8 facebook.com
dig @1.1.1.1 facebook.com
```

### 3. **Retry with Exponential Backoff**
```javascript
async function retryFacebookLogin(email, password, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await loginFacebook(email, password);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
      console.log(`Retry ${i + 1} in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

### 4. **Environment Variables for Debugging**
```bash
# Enable verbose networking logs
export NODE_DEBUG=net,http,https,tls
export DEBUG=*

# Run your application
npm start
```

## Alternative Solutions

### 1. **Use Mobile Hotspot**
Test if the issue is specific to your network:
```bash
# Connect to mobile hotspot and test
curl -I https://www.facebook.com
```

### 2. **Docker/Container Networking**
If running in Docker, check network configuration:
```bash
# Test from inside container
docker exec -it your-container curl -I https://www.facebook.com
```

### 3. **Proxy Configuration**
If behind corporate proxy:
```javascript
// Add proxy configuration to facebook-chat-api
const options = {
  proxy: 'http://proxy-server:port',
  // or
  agent: new HttpsProxyAgent('http://proxy-server:port')
};
```

## Production Considerations

### 1. **Graceful Degradation**
```javascript
// In your business controller
try {
  const result = await loginFacebook(email, password);
  platformResults.facebook = true;
} catch (error) {
  logger.error("Facebook login failed", { error: error.message });
  platformResults.facebook = false;
  // Continue with other platforms
}
```

### 2. **Health Check Endpoint**
```javascript
// Add to your routes
router.get('/health/facebook', async (req, res) => {
  try {
    const isReachable = await testFacebookConnectivity();
    res.json({ 
      status: isReachable ? 'healthy' : 'unreachable',
      timestamp: new Date()
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});
```

### 3. **Monitoring & Alerts**
```javascript
// Set up monitoring for Facebook connectivity
setInterval(async () => {
  const isReachable = await testFacebookConnectivity();
  if (!isReachable) {
    // Send alert to monitoring system
    logger.error("Facebook connectivity lost!");
  }
}, 300000); // Check every 5 minutes
```

## When All Else Fails

1. **Use Facebook's Official API**: Consider migrating to Facebook's official Messenger Platform API
2. **Alternative Libraries**: Research other Facebook chat libraries (though most have similar issues)
3. **Backup Communication**: Implement alternative communication channels

## Important Notes

- ⚠️ **facebook-chat-api is in maintenance mode** - expect occasional breaking changes
- 🌍 **Regional restrictions** - Some countries/ISPs block Facebook
- 🔄 **Temporary issues** - Often resolves itself after some time
- 🏢 **Corporate networks** - Often have stricter firewall rules

## Testing Your Fix

After implementing any solution:

```bash
# Test the endpoint
curl -X POST http://localhost:5001/business/platforms/your-business-id \
  -H "Content-Type: application/json" \
  -d '{
    "facebookEmail": "test@example.com",
    "facebookPassword": "testpassword"
  }'
```

The enhanced error handling will now provide more helpful error messages and the connectivity test will help diagnose the issue before attempting login.
