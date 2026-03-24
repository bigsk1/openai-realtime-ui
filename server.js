import express from "express";
import fs from "fs";
import dns from "node:dns/promises";
import net from "node:net";
import { createServer as createViteServer } from "vite";
import "dotenv/config";

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY;
const searxngUrl = process.env.SEARXNG_URL; 
const searxngAuthEnabled = process.env.SEARXNG_AUTH_ENABLED === 'true';
const searxngUser = process.env.SEARXNG_USER;
const searxngPass = process.env.SEARXNG_PASS;
const openaiModel = process.env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview-2024-12-17";
const ALLOWED_PROXY_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_PROXY_REDIRECTS = 5;

const blockedIpRanges = new net.BlockList();
blockedIpRanges.addAddress("0.0.0.0", "ipv4");
blockedIpRanges.addSubnet("10.0.0.0", 8, "ipv4");
blockedIpRanges.addSubnet("127.0.0.0", 8, "ipv4");
blockedIpRanges.addSubnet("169.254.0.0", 16, "ipv4");
blockedIpRanges.addSubnet("172.16.0.0", 12, "ipv4");
blockedIpRanges.addSubnet("192.168.0.0", 16, "ipv4");
blockedIpRanges.addSubnet("100.64.0.0", 10, "ipv4");
blockedIpRanges.addSubnet("198.18.0.0", 15, "ipv4");
blockedIpRanges.addSubnet("224.0.0.0", 4, "ipv4");
blockedIpRanges.addAddress("::", "ipv6");
blockedIpRanges.addAddress("::1", "ipv6");
blockedIpRanges.addSubnet("fc00::", 7, "ipv6");
blockedIpRanges.addSubnet("fe80::", 10, "ipv6");

const blockedHostnames = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
]);

const normalizeHostname = (hostname) => hostname.toLowerCase().replace(/\.+$/, "");

const isBlockedIpAddress = (address) => {
  const family = net.isIP(address);
  if (!family) return true;
  return blockedIpRanges.check(address, family === 4 ? "ipv4" : "ipv6");
};

const parseProxyTargetUrl = (targetUrl, baseUrl) => {
  let parsedUrl;
  try {
    parsedUrl = baseUrl ? new URL(targetUrl, baseUrl) : new URL(targetUrl);
  } catch {
    throw new Error("Invalid target URL");
  }

  if (!ALLOWED_PROXY_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }

  if (!parsedUrl.hostname) {
    throw new Error("Target URL hostname is required");
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("URL credentials are not allowed");
  }

  return parsedUrl;
};

const assertSafeProxyTarget = async (targetUrl) => {
  const hostname = normalizeHostname(targetUrl.hostname);

  if (!hostname) {
    throw new Error("Target URL hostname is required");
  }

  if (blockedHostnames.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error("Target host is blocked");
  }

  if (net.isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      throw new Error("Target IP address is blocked");
    }
    return;
  }

  let resolvedAddresses;
  try {
    resolvedAddresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Could not resolve target host");
  }

  if (!resolvedAddresses.length) {
    throw new Error("Could not resolve target host");
  }

  for (const { address } of resolvedAddresses) {
    if (isBlockedIpAddress(address)) {
      throw new Error("Target host resolves to a blocked IP address");
    }
  }
};

const fetchWithSafeRedirects = async (initialUrl, baseOptions) => {
  let currentUrl = initialUrl;
  let requestMethod = baseOptions.method;
  let requestBody = baseOptions.body;

  for (let redirectCount = 0; redirectCount <= MAX_PROXY_REDIRECTS; redirectCount += 1) {
    await assertSafeProxyTarget(currentUrl);

    const response = await fetch(currentUrl, {
      ...baseOptions,
      method: requestMethod,
      body: requestBody,
      redirect: "manual",
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const locationHeader = response.headers.get("location");
    if (!locationHeader) {
      return response;
    }

    if (redirectCount === MAX_PROXY_REDIRECTS) {
      throw new Error("Too many redirects");
    }

    currentUrl = parseProxyTargetUrl(locationHeader, currentUrl);

    // Align with common redirect semantics:
    // - 303 always becomes GET
    // - 301/302 switch POST to GET
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && requestMethod === "POST")
    ) {
      requestMethod = "GET";
      requestBody = undefined;
    }
  }

  throw new Error("Too many redirects");
};

// Configure Vite middleware for React client with reduced logging
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
  // Add logging options here for the server process
  logLevel: 'error',
  customLogger: {
    info: (msg) => {
      // Filter out specific noisy logs if needed beyond logLevel
      if (!msg.includes('[vite:css]') && !msg.includes('hmr update')) {
        console.info(msg);
      }
    },
    warn: (msg) => {
      if (!msg.includes('[vite:css]')) {
        console.warn(msg);
      }
    },
    error: console.error,
    warnOnce: console.warn,
  },
  css: {
    devSourcemap: false, 
    postcss: { 
      verbose: false, 
    },
  },
});
app.use(vite.middlewares);
app.use(express.json()); 

// API route for token generation
app.post("/token", async (req, res) => {
  try {
    const { voice = "verse", instructions } = req.body;
    console.log(`Generating token with voice: ${voice}${instructions ? " and custom instructions" : ""}`);
    
    // Build request body with optional instructions
    const requestBody = {
      model: openaiModel,
      voice: voice,
    };
    
    // Only add instructions if provided
    if (instructions) {
      requestBody.instructions = instructions;
    }
    
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      },
    );

    const data = await response.json();
    // Add the model to the response so client knows which model was used
    data.model = openaiModel;
    res.json(data);
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

// For backward compatibility, also support GET
app.get("/token", async (req, res) => {
  try {
    // Get instructions from query params if available
    const instructions = req.query.instructions;
    
    // Build request body with optional instructions
    const requestBody = {
      model: openaiModel,
      voice: "verse",
    };
    
    // Only add instructions if provided
    if (instructions) {
      requestBody.instructions = instructions;
    }
    
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      },
    );

    const data = await response.json();
    // Add the model to the response so client knows which model was used
    data.model = openaiModel;
    res.json(data);
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

// API route for web search using SearXNG
app.post("/api/search", async (req, res) => {
  const { query } = req.body;
  console.log(`Received search request for: ${query}`);
  
  if (!searxngUrl) {
    console.error("SEARXNG_URL is not defined in environment variables.");
    return res.status(500).json({ error: "Search service is not configured." });
  }
  
  if (!query) {
    return res.status(400).json({ error: "Missing search query" });
  }
  
  try {
    // Now we can use JSON format directly!
    const searchParams = new URLSearchParams({ 
      q: query,
      format: 'json',
      category_general: '1'
    });
    
    const requestUrl = `${searxngUrl}/search?${searchParams.toString()}`;
    console.log(`Fetching from SearXNG: ${requestUrl}`);
    
    // Build headers with authentication if enabled
    const headers = { 
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    };
    
    // Add basic auth if enabled
    if (searxngAuthEnabled && searxngUser && searxngPass) {
      const authString = `${searxngUser}:${searxngPass}`;
      const base64Auth = Buffer.from(authString).toString('base64');
      headers['Authorization'] = `Basic ${base64Auth}`;
      console.log('Using Basic Authentication for SearXNG');
    }
    
    const searchResponse = await fetch(requestUrl, { headers });
    
    if (!searchResponse.ok) {
      throw new Error(`SearXNG request failed with status ${searchResponse.status}: ${await searchResponse.text()}`);
    }
    
    // Parse the JSON response directly
    const searchData = await searchResponse.json();
    
    // Transform to our simplified format - using consistent field names
    const results = (searchData.results || []).slice(0, 3).map(item => ({
      title: item.title ? String(item.title).slice(0, 100) : "No title",
      url: item.url ? String(item.url).slice(0, 500) : "#", 
      content: item.content ? String(item.content).slice(0, 150) : "No content available."
    }));
    
    console.log(`Found ${results.length} results from SearXNG JSON response.`);
    res.json({ results });
  } catch (error) {
    console.error("SearXNG search endpoint error:", error);
    res.status(500).json({ error: `Failed to perform search: ${error.message}` });
  }
});


// Universal webhook proxy - handles ANY external API
app.all("/api/proxy", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: "Missing target URL parameter" });
  }
  
  try {
    console.log(`Proxying ${req.method} request to: ${targetUrl}`);
    
    // Build request options
    const options = {
      method: req.method,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json, text/plain, */*',
      }
    };
    
    // Copy relevant headers from the original request
    // Don't copy host, origin, etc. which would cause issues
    const headersToForward = [
      'content-type', 
      'accept', 
      'x-api-key', 
      'authorization',
      // Additional auth headers that might be used
      'x-access-token',
      'x-auth-token',
      'api-key',
      'token',
      'bearer',
      'cookie'
    ];
    
    // Forward all headers that match the pattern
    Object.keys(req.headers).forEach(header => {
      if (headersToForward.includes(header.toLowerCase()) || 
          header.toLowerCase().startsWith('x-') || 
          header.toLowerCase().includes('auth') || 
          header.toLowerCase().includes('token') ||
          header.toLowerCase().includes('key')) {
        options.headers[header] = req.headers[header];
      }
    });
    
    // Handle request body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (req.headers['content-type']?.includes('application/json')) {
        options.body = JSON.stringify(req.body);
      } else if (req.body) {
        options.body = req.body;
      }
    }
    
    // Append query parameters if this is a GET request and there are params
    let fullUrl = String(targetUrl);
    if (req.method === 'GET' && Object.keys(req.query).length > 1) { // > 1 because 'url' is always there
      const params = new URLSearchParams();
      Object.entries(req.query).forEach(([key, value]) => {
        if (key !== 'url') { // Skip the 'url' parameter
          if (Array.isArray(value)) {
            value.forEach((item) => params.append(key, item));
          } else {
            params.append(key, value);
          }
        }
      });
      const queryString = params.toString();
      if (queryString) {
        fullUrl += (fullUrl.includes('?') ? '&' : '?') + queryString;
      }
    }

    const parsedTargetUrl = parseProxyTargetUrl(fullUrl);

    // Make the request to the target URL, validating each redirect hop.
    const response = await fetchWithSafeRedirects(parsedTargetUrl, options);
    
    // Copy status code
    res.status(response.status);
    
    // Copy relevant headers from the response
    const responseHeaders = response.headers;
    const headersToReturn = ['content-type', 'cache-control', 'etag'];
    headersToReturn.forEach(header => {
      const value = responseHeaders.get(header);
      if (value) {
        res.setHeader(header, value);
      }
    });
    
    // Handle response based on content type
    const contentType = responseHeaders.get('content-type');
    if (contentType) {
      if (contentType.includes('application/json')) {
        const data = await response.json();
        res.json(data);
      } else {
        const text = await response.text();
        res.send(text);
      }
    } else {
      const text = await response.text();
      res.send(text);
    }
    
  } catch (error) {
    console.error("Proxy request error:", error);
    const statusCode = [
      "Invalid target URL",
      "Only http and https URLs are allowed",
      "Target URL hostname is required",
      "URL credentials are not allowed",
      "Target host is blocked",
      "Target IP address is blocked",
      "Could not resolve target host",
      "Target host resolves to a blocked IP address",
      "Too many redirects",
    ].includes(error.message)
      ? 400
      : 500;

    res.status(statusCode).json({
      error: `Proxy request failed: ${error.message}`,
      target_url: targetUrl
    });
  }
});

// Add a route to expose which env vars are available (not their values)
app.get('/api/config', (req, res) => {
  // Add cache control headers
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  
  // Create a list of available environment variables (not including their values)
  const availableEnvVars = {
    SEARXNG_URL: !!process.env.SEARXNG_URL,
    SEARXNG_AUTH_ENABLED: process.env.SEARXNG_AUTH_ENABLED === 'true',
    // Add other env vars that tools might depend on
  };
  
  // console.log("Sending config to client:", { 
  //   searxng: !!process.env.SEARXNG_URL,
  //   env_vars_present: Object.keys(availableEnvVars).filter(key => availableEnvVars[key])
  // });
  
  res.json({ availableEnvVars });
});

// Render the React client
app.use("*", async (req, res, next) => {
  const url = req.originalUrl;

  try {
    const template = await vite.transformIndexHtml(
      url,
      fs.readFileSync("./client/index.html", "utf-8"),
    );
    const { render } = await vite.ssrLoadModule("./client/entry-server.jsx");
    const appHtml = await render(url);
    const html = template.replace(`<!--ssr-outlet-->`, appHtml?.html);
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  } catch (e) {
    vite.ssrFixStacktrace(e);
    next(e);
  }
});

app.listen(port, () => {
  console.log(`Express server running on *:${port}`);
});
