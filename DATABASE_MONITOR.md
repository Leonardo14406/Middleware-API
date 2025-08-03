# Database Change Monitor

## Overview

The Database Change Monitor automatically restarts the server when critical database changes are detected, ensuring that the application immediately reflects changes like deleted business records or modified webhook tokens.

## Features

- **Automatic Server Restart**: Detects when businesses are deleted and triggers an immediate server restart
- **Critical Field Monitoring**: Monitors changes to webhook-related fields:
  - `facebookVerifyToken`
  - `whatsappVerifyToken` 
  - `recipientId`
  - `channelId`
- **Configurable Interval**: Set monitoring frequency via environment variable
- **Graceful Shutdown**: Properly cleans up monitoring on server shutdown

## Configuration

### Environment Variables

```bash
# Set monitoring interval (default: 5000ms = 5 seconds)
DB_MONITOR_INTERVAL=5000
```

### Automatic Startup

The monitor starts automatically when the server starts. You'll see this log message:

```
Database change monitor started - Initial business count: X, Monitoring interval: 5000ms
```

## How It Works

1. **Initial State**: On startup, the monitor captures the current state of all businesses
2. **Periodic Checks**: Every 5 seconds (configurable), it checks for changes
3. **Change Detection**: Detects:
   - Deleted businesses
   - Changes to webhook verification tokens
   - Changes to platform identifiers (recipientId, channelId)
4. **Server Restart**: When critical changes are detected, the server gracefully shuts down and restarts

## Testing

Use the provided test script to verify the monitoring works:

```bash
node test-db-monitor.js
```

**⚠️ Warning**: This test will temporarily delete a business record to test the restart functionality.

## Use Cases

### Production Deployment
- When you delete a business from your admin panel, the server automatically restarts to clear any cached webhook configurations
- When webhook tokens are updated, the server restarts to use the new tokens immediately

### Development
- Prevents stale webhook configurations during development
- Ensures immediate pickup of database changes without manual server restarts

## Process Management Compatibility

This feature works with:
- **PM2**: Will automatically restart the process
- **Docker**: Container will restart if restart policy is configured
- **Nodemon**: Will restart in development mode
- **systemd**: Will restart if configured with `Restart=always`

## Logging

The monitor logs all activities:

```javascript
// Startup
"Database change monitor started"

// Change detection
"Critical database changes detected - triggering server refresh"

// Shutdown
"Database change monitor stopped"
```

## Manual Control

```javascript
import dbChangeMonitor from './src/services/dbChangeMonitor.js';

// Start monitoring
await dbChangeMonitor.start();

// Stop monitoring
dbChangeMonitor.stop();
```
