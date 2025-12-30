# Troubleshooting E2E Tests

## Common Issues

### Proxy Error: ECONNREFUSED on port 8081

**Error Message:**
```
Proxy error: Could not proxy request /api/rooms/... from localhost:3000 to http://localhost:8081/.
ECONNREFUSED
```

**Cause:** The backend server is not running on port 8081.

**Solution:**

1. **Start the backend server** from the project root:
   ```bash
   npm run start-server
   ```
   Or from the `server` directory:
   ```bash
   cd server
   npm start
   ```

2. **Verify the server is running:**
   - You should see: `App started at 0.0.0.0:8081` in the server console
   - Check if port 8081 is listening:
     ```powershell
     netstat -ano | findstr :8081
     ```
   - Or test the API directly:
     ```powershell
     curl http://localhost:8081/api/rooms
     ```

3. **Start both UI and server together** (from project root):
   ```bash
   npm run start
   ```
   This starts both the server (port 8081) and UI (port 3000) in parallel.

### Server Starts But Immediately Crashes

**Possible causes:**
- Missing dependencies: Run `npm install` in the `server` directory
- Missing Twilio credentials: The server may need `server/secret/index.js` with Twilio config (though it might work without it)
- Port 8081 already in use: Check if another process is using port 8081

**Solution:**
1. Check server console for error messages
2. Ensure all dependencies are installed:
   ```bash
   cd server
   npm install
   ```
3. Check if port is in use:
   ```powershell
   netstat -ano | findstr :8081
   ```

### Test Fails: "Backend server is not running"

The E2E test checks if the server is running before starting. Make sure:
1. Server is started before running tests
2. Server is listening on port 8081 (not a different port)
3. No firewall is blocking localhost connections

### Room Creation Fails

If the server is running but room creation still fails:
1. Check browser console for detailed error messages
2. Check server console for API request logs
3. Verify the proxy configuration in `ui/package.json` points to `http://localhost:8081`

