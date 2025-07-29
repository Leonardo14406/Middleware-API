# Facebook Service Usage Guide

## Overview
The Facebook service uses the `facebook-chat-api` library to enable automated messaging through Facebook Messenger. This service handles login, session management, and messaging operations.

## Important Notes
⚠️ **Disclaimer**: The `facebook-chat-api` is in maintenance mode and may break due to Facebook changes. Use responsibly and avoid spammy behavior that could result in account bans.

## Key Features

### 1. Login & Authentication
```javascript
const { loginFacebook } = require('./facebookService');

// Login with email and password
const result = await loginFacebook('your-email@example.com', 'your-password');
// Returns: { api, serialized }
```

### 2. Session Management
- **Automatic Caching**: Sessions are cached in Redis for 1 hour
- **Session Restoration**: Can restore from saved app state
- **Fallback Logic**: Redis → Database → Fresh login

### 3. Messaging Operations
```javascript
// Send a simple text message
await sendMessage(api, threadId, "Hello world!");

// Send a message with attachment
await sendMessage(api, threadId, {
  body: "Check out this image!",
  attachment: fs.createReadStream('image.jpg')
});

// Send typing indicator
await sendTypingIndicator(api, threadId);

// Mark message as read
await markAsRead(api, threadId);
```

### 4. Information Retrieval
```javascript
// Get recent messages
const messages = await fetchRecentMessages(api, 20);

// Get user information
const userInfo = await getUserInfo(api, ['user_id_1', 'user_id_2']);

// Get thread information
const threadInfo = await getThreadInfo(api, threadId);
```

## Integration with Business Platform

### Adding Facebook Credentials
```bash
POST /business/platforms/{businessId}
{
  "facebookEmail": "your-facebook@example.com",
  "facebookPassword": "your-password"
}
```

### Response Format
```json
{
  "message": "Platform credentials processed. X platforms configured successfully.",
  "platforms": {
    "facebook": true,
    ...
  },
  "businessId": "your-business-id"
}
```

## Error Handling

The service includes comprehensive error handling:

- **Login Errors**: Invalid credentials, 2FA required, account locked
- **Session Errors**: Expired sessions, invalid app state
- **Message Errors**: Thread not found, user blocked, rate limiting
- **Network Errors**: Connection timeouts, Facebook API changes

## Security Considerations

1. **Credentials Storage**: Passwords are not stored; only session tokens
2. **Logging**: Email addresses are partially masked in logs
3. **Session Expiry**: Cached sessions expire after 1 hour
4. **Rate Limiting**: Be mindful of Facebook's rate limits

## Troubleshooting

### Common Issues

1. **Login Fails**
   - Verify credentials work on Facebook website
   - Check if 2FA is enabled (may require special handling)
   - Ensure account isn't temporarily locked

2. **Session Restoration Fails**
   - Session may have expired
   - Facebook may have invalidated the session
   - Try fresh login

3. **Message Sending Fails**
   - User may have blocked the account
   - Thread may not exist
   - Rate limiting may be in effect

### Debug Mode
Enable detailed logging:
```javascript
api.setOptions({
  logLevel: "silly" // or "verbose"
});
```

## Best Practices

1. **Respect Rate Limits**: Don't send messages too quickly
2. **Handle Errors Gracefully**: Always implement proper error handling
3. **Save App State**: Use `api.getAppState()` to avoid repeated logins
4. **Monitor Sessions**: Check session validity periodically
5. **Be a Good Citizen**: Follow Facebook's terms of service

## Example Usage in Controller

The business controller automatically handles Facebook integration:

```javascript
// When adding platform credentials
const { serialized: fbSerialized } = await loginFacebook(
  facebookEmail,
  facebookPassword,
);

// Save to database
await prisma.session.upsert({
  where: {
    businessId_platform: {
      businessId,
      platform: "FACEBOOK",
    },
  },
  update: { serializedCookies: fbSerialized },
  create: {
    businessId,
    platform: "FACEBOOK", 
    serializedCookies: fbSerialized,
  },
});
```

## Testing

Use Facebook Whitehat Accounts for testing to avoid using personal accounts:
https://www.facebook.com/whitehat/accounts/

This ensures safe testing without risking your main Facebook account.
