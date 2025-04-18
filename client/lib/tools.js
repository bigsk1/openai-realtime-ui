// client/lib/tools.js

// --- Tool Execution Logic ---

// Simulates fetching search results (replace with actual API call later if needed)
// Note: This function is defined here but will be called from ToolPanel
async function fetchSearchResults(query) {
  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Search API request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.results) {
      console.warn("Search API response missing 'results' property");
    }
    
    return data.results || [];
  } catch (error) {
    console.error("Failed to fetch search results:", error.message);
    // Re-throw the error to be caught by the caller in ToolPanel
    throw error; 
  }
}

// Helper to detect if an endpoint is a SearXNG search endpoint
function isSearxngEndpoint(url = '', key = '', description = '') {
  return url.includes('searx') || 
         url.includes(':8080/search') || 
         key.toLowerCase().includes('searx') ||
         (description && description.toLowerCase().includes('searx'));
}

// Clean search parameters for SearXNG endpoints
function cleanSearxngParams(params) {
  // Remove problematic parameters that break SearXNG searches
  const cleaned = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (key !== 'category_general' && key !== 'categories_general') {
      cleaned.append(key, value);
    }
  }
  return cleaned;
}

// Webhook fetching function
async function callWebhook(method, endpointConfig, payload) {
  const url = typeof endpointConfig === 'string' ? endpointConfig : endpointConfig.url;
  const description = typeof endpointConfig === 'object' ? endpointConfig.description : '';
  
  // Get authentication method and related properties
  const authMethod = typeof endpointConfig === 'object' ? endpointConfig.authMethod || 'none' : 'none';
  const apiKey = typeof endpointConfig === 'object' ? endpointConfig.apiKey : null;
  const apiKeyHeaderName = typeof endpointConfig === 'object' ? endpointConfig.apiKeyHeaderName || 'X-API-Key' : 'X-API-Key';
  const username = typeof endpointConfig === 'object' ? endpointConfig.username : null;
  const password = typeof endpointConfig === 'object' ? endpointConfig.password : null;
  const bearerToken = typeof endpointConfig === 'object' ? endpointConfig.bearerToken : null;
  const customHeaderName = typeof endpointConfig === 'object' ? endpointConfig.customHeaderName : null;
  const customHeaderValue = typeof endpointConfig === 'object' ? endpointConfig.customHeaderValue : null;
  
  // Always enforce the required method from the endpoint config
  const requiredMethod = typeof endpointConfig === 'object' && endpointConfig.method && endpointConfig.method !== 'ANY'
    ? endpointConfig.method
    : method;
  
  // Determine if this is an external URL that needs proxy routing
  const isExternalUrl = url.startsWith('http') && !url.includes(window.location.host);
  
  // For external URLs, route through our proxy
  let targetUrl = url;
  if (isExternalUrl) {
    console.log(`Routing external URL through proxy: ${url}`);
    targetUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
  }
  
  console.log(`Making ${requiredMethod} request to webhook endpoint: ${isExternalUrl ? 'proxy -> ' + url : url}`);
  
  try {
    const headers = { 
      'Content-Type': 'application/json'
    };
    
    // Apply authentication based on method
    switch (authMethod) {
      case 'apiKey':
        if (apiKey) {
          headers[apiKeyHeaderName] = apiKey;
          console.log(`Using API Key authentication with header: ${apiKeyHeaderName}`);
        }
        break;
      
      case 'basicAuth':
        if (username) {
          const credentials = btoa(`${username}:${password || ''}`);
          headers['Authorization'] = `Basic ${credentials}`;
          console.log('Using Basic Authentication');
        }
        break;
      
      case 'bearerToken':
        if (bearerToken) {
          headers['Authorization'] = `Bearer ${bearerToken}`;
          console.log('Using Bearer Token authentication');
        }
        break;
      
      case 'customHeader':
        if (customHeaderName && customHeaderValue) {
          headers[customHeaderName] = customHeaderValue;
          console.log(`Using Custom Header authentication: ${customHeaderName}`);
        }
        break;
      
      case 'none':
      default:
        console.log('No authentication used');
        break;
    }
    
    let response;
    let finalUrl = targetUrl;
    
    if (requiredMethod === 'GET') {
      // For GET requests with payload, append as query parameters
      if (payload) {
        const params = new URLSearchParams();
        Object.entries(payload).forEach(([key, value]) => {
          params.append(key, typeof value === 'string' ? value : JSON.stringify(value));
        });
        
        // Special handling for SearXNG endpoints
        if (isSearxngEndpoint(url, '', description)) {
          const cleanedParams = cleanSearxngParams(params);
          
          if (isExternalUrl) {
            // For external URLs being proxied, add params to the proxy URL
            finalUrl = `${targetUrl}&${cleanedParams.toString()}`;
          } else {
            // For direct URLs, add params to the target URL
            finalUrl = `${url}?${cleanedParams.toString()}`;
          }
          console.log('Using cleaned SearXNG parameters:', finalUrl);
        } else {
          if (isExternalUrl) {
            // For external URLs being proxied, add params to the proxy URL
            finalUrl = `${targetUrl}&${params.toString()}`;
          } else {
            // For direct URLs, add params to the target URL
            finalUrl = `${url}?${params.toString()}`;
          }
        }
      }
      
      response = await fetch(finalUrl, { headers });
    } else {
      // If method is POST, ensure we have a valid payload
      const body = payload ? JSON.stringify(payload) : JSON.stringify({});
      
      // For POST requests, the URL doesn't change (no query params to add)
      response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body,
      });
    }
    
    if (!response.ok) {
      throw new Error(`Webhook request failed with status: ${response.status}`);
    }
    
    // First check content type to determine if it's JSON
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        const data = await response.json();
        return data;
      } catch (error) {
        console.error("Failed to parse JSON response");
        const text = await response.text();
        return { text: text || "Empty response", _non_json_response: true };
      }
    } else {
      // Not JSON, return as text
      const text = await response.text();
      return { text: text || "Empty response", _non_json_response: true };
    }
  } catch (error) {
    console.error("Webhook request failed:", error.message);
    throw error;
  }
}

// --- Tool Definitions and Configuration ---

export const tools = {
  // --- Display Color Palette Tool ---
  display_color_palette: {
    // Definition sent to the AI
    definition: {
      type: "function",
      name: "display_color_palette",
      description: "Call this function when a user asks for a color palette.",
      parameters: {
        type: "object",
        strict: true,
        properties: {
          theme: {
            type: "string",
            description: "Description of the theme for the color scheme.",
          },
          colors: {
            type: "array",
            description: "Array of five hex color codes based on the theme.",
            items: { type: "string", description: "Hex color code" },
          },
        },
        required: ["theme", "colors"],
      },
    },
    // Execution logic (runs on the client when AI calls the tool)
    execute: async (args) => {
      // This tool doesn't *do* anything async, it just displays args.
      // Return success immediately.
      return { status: 'success', content: JSON.stringify(args) }; 
    },
    // React component used to render the output in ToolPanel
    // We'll define the actual component in ToolPanel for simplicity for now,
    // but ideally, it could be imported here too.
    OutputComponent: 'ColorPaletteOutput',
    // No env vars required for this tool
    requiredEnvVars: [], 
  },

  // --- Web Search Tool ---
  web_search: {
    // Definition sent to the AI
    definition: {
      type: "function",
      name: "web_search",
      description: "Call this function to search the web for information." + 
        (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.SEARXNG_AUTH_ENABLED ? 
          " (Using authenticated SearXNG instance)" : ""),
      parameters: {
        type: "object",
        strict: true,
        properties: {
          query: {
            type: "string",
            description: "The search query to use.",
          },
        },
        required: ["query"],
      },
    },
    // Execution logic
    execute: async (args) => {
      try {
        if (!args.query || args.query.trim() === '') {
          throw new Error("Search query cannot be empty");
        }
        
        // Calls the fetch function defined above
        const results = await fetchSearchResults(args.query);
        
        // Return minimal data - follow the OpenAI function format
        return { 
          status: 'success', 
          content: JSON.stringify(results) 
        }; 
      } catch (error) {
        console.error("Search failed:", error.message);
        // Return a simple error structure
        return {
          status: 'error',
          content: JSON.stringify({ 
            error: "Search failed", 
            message: error.message 
          })
        };
      }
    },
    // React component used to render the output
    OutputComponent: 'WebSearchResultsOutput',
    // This tool requires SEARXNG_URL to be defined in the environment
    requiredEnvVars: ['SEARXNG_URL'], 
  },

  // --- Universal Webhook Tool ---
  webhook_call: {
    // Definition sent to the AI
    definition: {
      type: "function",
      name: "webhook_call",
      description: "Make a call to a user-configured webhook endpoint to trigger actions or retrieve information from external services. IMPORTANT: For POST requests, you MUST include a payload object with all required fields described in the endpoint's description. The following endpoints are available: " + 
        (typeof window !== 'undefined' && typeof localStorage !== 'undefined' ? 
          Object.keys(JSON.parse(localStorage.getItem('webhookEndpoints') || '{}')).join(', ') : 
          '[endpoints will be available at runtime]') +
        "\n\nImportant Note: Search endpoints require a payload with a 'query' field containing the search term.",
      parameters: {
        type: "object",
        strict: true,
        properties: {
          method: {
            type: "string",
            description: "HTTP method to use for the request. Note: Some endpoints require specific methods regardless of what you specify here.",
            enum: ["GET", "POST"]
          },
          payload: {
            type: "object",
            description: "payload is the only valid field to send POST body content. Do not use data, body, or any other field. to send with the request. payload is (REQUIRED for POST requests). For search endpoints, this MUST include a 'query' field with the specific search term.",
          },
          endpoint_key: {
            type: "string",
            description: "Key name of the saved endpoint to use. Must match one of the available endpoints exactly: " + 
              (typeof window !== 'undefined' && typeof localStorage !== 'undefined' ? 
                Object.keys(JSON.parse(localStorage.getItem('webhookEndpoints') || '{}')).join(', ') : 
                '[endpoints will be available at runtime]'),
          }
        },
        required: ["endpoint_key"],
      },
    },
    // No specific environment variables needed for webhook_call as it's based on user-configured endpoints
    requiredEnvVars: [],
    
    // Execution logic
    execute: async (args) => {
      try {
        // Get endpoints from localStorage
        const savedEndpoints = JSON.parse(localStorage.getItem('webhookEndpoints') || '{}');
        
        // Check if endpoint key exists exactly as provided first
        let endpointConfig = savedEndpoints[args.endpoint_key];
        let matchingKey = args.endpoint_key;
        
        // If not found with exact key, try normalized versions
        if (!endpointConfig) {
          // Normalize the endpoint key - replace underscores with dashes and make lowercase
          const normalizedKey = args.endpoint_key.replace(/_/g, '-').toLowerCase();
          
          endpointConfig = savedEndpoints[normalizedKey];
          matchingKey = normalizedKey;
          
          // If still not found, try a case-insensitive search
          if (!endpointConfig) {
            const availableKeys = Object.keys(savedEndpoints);
            matchingKey = availableKeys.find(key => 
              key.toLowerCase() === normalizedKey || 
              key.toLowerCase().replace(/_/g, '-') === normalizedKey
            );
            
            if (matchingKey) {
              endpointConfig = savedEndpoints[matchingKey];
            }
          }
        }
        
        if (!endpointConfig) {
          // Return a more helpful error message that includes all available endpoints
          const availableEndpoints = Object.keys(savedEndpoints).join(', ');
          const errorMsg = `Endpoint "${args.endpoint_key}" not found. Available endpoints: ${availableEndpoints || 'None'}`;
          console.error(errorMsg);
          return {
            status: 'error',
            content: JSON.stringify({ 
              error: errorMsg,
              available_endpoints: Object.keys(savedEndpoints)
            })
          };
        }
        
        // Get endpoint description and preferred method
        const description = typeof endpointConfig === 'object' && endpointConfig.description 
          ? endpointConfig.description 
          : null;
          
        const requiredMethod = typeof endpointConfig === 'object' && endpointConfig.method 
          ? endpointConfig.method 
          : 'ANY';
        
        // Determine which HTTP method to use - prioritize endpoint required method
        let actualMethod = requiredMethod !== 'ANY' ? requiredMethod : (args.method || 'GET');
        
        // Flag if we're using a search endpoint (for automatic query handling)
        const isSearchEndpoint = matchingKey.toLowerCase().includes('search') || 
                            (description && description.toLowerCase().includes('search'));
                            
        // Flag if this is a SearXNG endpoint for special handling
        const isSearxEngine = isSearxngEndpoint(
          typeof endpointConfig === 'string' ? endpointConfig : endpointConfig.url,
          matchingKey,
          description
        );
        
        // For POST endpoints, ensure there's a payload
        let actualPayload = args.payload;
        if (actualMethod === 'POST' && !actualPayload) {
          // For search endpoints without payload, try to extract query from args
          if (isSearchEndpoint && args.query) {
            console.log("Auto-creating search payload with query:", args.query);
            actualPayload = { query: args.query };
          } else if (requiredMethod === 'POST') {
            // Only error if the endpoint actually requires POST
            const errorMsg = `POST request to "${matchingKey}" requires a payload. ${description || ''}`;
            console.error(errorMsg);
            return {
              status: 'error',
              content: JSON.stringify({ 
                error: errorMsg,
                endpoint_info: {
                  name: matchingKey,
                  required_method: requiredMethod,
                  description: description
                }
              })
            };
          }
        }
        
        // Special handling for SearXNG - they need POST method for reliable results
        if (isSearxEngine && actualMethod === 'GET' && actualPayload && actualPayload.query) {
          console.log("Switching SearXNG from GET to POST for better compatibility");
          actualMethod = 'POST';
        }
        
        // Create a formatted message about the webhook operation
        console.log(`Calling webhook ${matchingKey} with ${actualMethod} method`);
        
        // Call the webhook with the endpoint config
        const data = await callWebhook(actualMethod, endpointConfig, actualPayload);
        
        // Special handling for search responses
        let responseNote = "Process this data intelligently instead of repeating it verbatim.";
        if (isSearchEndpoint) {
          responseNote = "IMPORTANT: Don't repeat these search results verbatim. Summarize key information and respond in a natural way. If the query yielded no useful results, acknowledge this and offer to try a different search.";
        }
        
        // Return success with data and metadata
        return { 
          status: 'success', 
          content: JSON.stringify({
            endpoint: matchingKey,
            data: data,
            // Include response format information
            ...(data && data._non_json_response && { format: "text" }),
            // Include description and instructions for AI
            endpoint_description: description || "No description available",
            note: responseNote
          })
        };
      } catch (error) {
        console.error("Webhook tool failed:", error.message);
        return {
          status: 'error',
          content: JSON.stringify({ 
            error: error.message,
            available_endpoints: Object.keys(JSON.parse(localStorage.getItem('webhookEndpoints') || '{}'))
          })
        };
      }
    },
    // React component used to render the output
    OutputComponent: 'WebhookResultOutput', 
  },

  // Current datetime tool that provides precise time information
  current_datetime: {
    definition: {
      type: "function",
      name: "current_datetime",
      description: "Get the current date and time in various formats and timezones. Use this when you need to know the exact current time.",
      parameters: {
        type: "object",
        strict: true,
        properties: {
          format: {
            type: "string",
            description: "Optional format for the date/time. Defaults to ISO format if not specified.",
            enum: ["iso", "human", "unix", "date", "time"],
          },
          timezone: {
            type: "string",
            description: "Optional timezone for the returned time. Defaults to local timezone if not specified.",
            enum: ["local", "utc", "est", "cst", "mst", "pst"]
          }
        },
        required: [],
      },
    },
    execute: async (args) => {
      try {
        const format = args.format || "iso";
        const timezone = args.timezone || "local";
        
        // Get current date
        const now = new Date();
        
        // Handle timezone
        let dateInTz = now;
        if (timezone !== "local") {
          const options = { timeZone: getTimeZoneString(timezone) };
          dateInTz = new Date(new Date().toLocaleString('en-US', options));
        }
        
        // Format the date
        let formattedDate;
        switch (format) {
          case "human":
            formattedDate = dateInTz.toLocaleString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric',
              hour: 'numeric',
              minute: 'numeric',
              second: 'numeric',
              timeZoneName: 'short'
            });
            break;
          case "unix":
            formattedDate = Math.floor(dateInTz.getTime() / 1000);
            break;
          case "date":
            formattedDate = dateInTz.toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            });
            break;
          case "time":
            formattedDate = dateInTz.toLocaleTimeString('en-US', { 
              hour: 'numeric',
              minute: 'numeric',
              second: 'numeric',
              timeZoneName: 'short'
            });
            break;
          case "iso":
          default:
            formattedDate = dateInTz.toISOString();
            break;
        }
        
        return { 
          status: 'success', 
          content: JSON.stringify({
            current: formattedDate,
            timezone: timezone,
            format: format,
            timestamp: Math.floor(now.getTime() / 1000)
          })
        };
      } catch (error) {
        console.error("Date/time tool failed:", error);
        return {
          status: 'error',
          content: JSON.stringify({ error: error.message || "Failed to get current date and time" })
        };
      }
    },
    OutputComponent: 'DateTimeOutput',
    // No environment variables required - always available
    requiredEnvVars: [],
  },
  
  // Clipboard Manager Tool
  clipboard_manager: {
    definition: {
      type: "function",
      name: "clipboard_manager",
      description: "Manage clipboard history. Save text to the clipboard, retrieve past entries, or view the clipboard history. Each entry is automatically timestamped.",
      parameters: {
        type: "object",
        strict: true,
        properties: {
          action: {
            type: "string",
            description: "Action to perform on the clipboard",
            enum: ["save", "get", "list", "clear", "delete"]
          },
          text: {
            type: "string",
            description: "Text to save to clipboard (required for 'save' action)"
          },
          entry_id: {
            type: "number",
            description: "ID of the clipboard entry to retrieve or delete (required for 'get' and 'delete' actions)"
          },
          limit: {
            type: "number",
            description: "Maximum number of entries to return when listing (optional for 'list' action)",
          }
        },
        required: ["action"],
      },
    },
    execute: async (args) => {
      try {
        const action = args.action;
        
        // Get current clipboard from localStorage
        const clipboardHistory = JSON.parse(localStorage.getItem('clipboardHistory') || '[]');
        
        let result = {};
        
        switch (action) {
          case 'save':
            if (!args.text) {
              throw new Error("Text is required for 'save' action");
            }
            
            // Create new entry with timestamp
            const newEntry = {
              id: Date.now(),
              text: args.text,
              timestamp: new Date().toISOString(),
              created: new Date().toLocaleString()
            };
            
            // Add to beginning of array (newest first)
            clipboardHistory.unshift(newEntry);
            
            // Save back to localStorage (limit to 50 entries)
            localStorage.setItem('clipboardHistory', JSON.stringify(clipboardHistory.slice(0, 50)));
            
            // Dispatch event to update UI
            window.dispatchEvent(new CustomEvent('clipboard-updated', {
              detail: { action: 'save', entry: newEntry }
            }));
            
            result = {
              success: true,
              message: "Text saved to clipboard",
              entry: newEntry
            };
            break;
            
          case 'get':
            if (args.entry_id === undefined) {
              throw new Error("Entry ID is required for 'get' action");
            }
            
            const entry = clipboardHistory.find(e => e.id === args.entry_id);
            if (!entry) {
              throw new Error(`Entry with ID ${args.entry_id} not found`);
            }
            
            result = {
              success: true,
              entry: entry
            };
            break;
            
          case 'list':
            const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 50) : 10;
            result = {
              success: true,
              entries: clipboardHistory.slice(0, limit),
              total: clipboardHistory.length
            };
            break;
            
          case 'clear':
            localStorage.setItem('clipboardHistory', '[]');
            
            // Dispatch event to update UI
            window.dispatchEvent(new CustomEvent('clipboard-updated', {
              detail: { action: 'clear' }
            }));
            
            result = {
              success: true,
              message: "Clipboard history cleared"
            };
            break;
            
          case 'delete':
            if (args.entry_id === undefined) {
              throw new Error("Entry ID is required for 'delete' action");
            }
            
            const newHistory = clipboardHistory.filter(e => e.id !== args.entry_id);
            if (newHistory.length === clipboardHistory.length) {
              throw new Error(`Entry with ID ${args.entry_id} not found`);
            }
            
            localStorage.setItem('clipboardHistory', JSON.stringify(newHistory));
            
            // Dispatch event to update UI
            window.dispatchEvent(new CustomEvent('clipboard-updated', {
              detail: { action: 'delete', entry_id: args.entry_id }
            }));
            
            result = {
              success: true,
              message: `Entry with ID ${args.entry_id} deleted`,
              remaining: newHistory.length
            };
            break;
            
          default:
            throw new Error(`Unknown action: ${action}`);
        }
        
        return { 
          status: 'success', 
          content: JSON.stringify(result)
        };
      } catch (error) {
        console.error("Clipboard tool failed:", error);
        return {
          status: 'error',
          content: JSON.stringify({ error: error.message || "Failed to manage clipboard" })
        };
      }
    },
    OutputComponent: 'ClipboardOutput',
    // No environment variables required - always available
    requiredEnvVars: [],
    // Make sure the clipboard is initialized properly
    initialize: () => {
      // Only initialize if clipboard history is empty
      if (!localStorage.getItem('clipboardHistory') || localStorage.getItem('clipboardHistory') === '[]') {
        // console.log("Clipboard history not found, initializing empty history");
        localStorage.setItem('clipboardHistory', '[]');
      } else {
        // console.log("Found existing clipboard history, preserving it");
      }
    },
  },
  
  // === NEW TOOL PLACEHOLDER ===
  // Uncomment and modify this template to add a new tool
  /*
  my_new_tool: {
    definition: {
      type: "function",
      name: "my_new_tool",
      description: "Description of what your tool does",
      parameters: {
        type: "object",
        strict: true,
        properties: {
          // Define your parameters here
        },
        required: [], // List required parameters
      },
    },
    execute: async (args) => {
      try {
        // Your tool implementation
        return { 
          status: 'success', 
          content: JSON.stringify({ result: "your result here" }) 
        };
      } catch (error) {
        return {
          status: 'error',
          content: JSON.stringify({ error: error.message })
        };
      }
    },
    OutputComponent: 'MyNewToolOutput',
    requiredEnvVars: [], // List any required env variables or [] for none
  },
  */
  
  // Other existing tools...
};

// Check if required environment variables are set for a tool
const isToolEnabled = (tool) => {
  // During server-side rendering, consider all tools enabled
  // This will be refined when the client loads
  if (typeof window === 'undefined') {
    // console.log(`SSR: Temporarily enabling ${tool.definition.name}`);
    return true;
  }
  
  if (!tool.requiredEnvVars || tool.requiredEnvVars.length === 0) {
    // console.log(`${tool.definition.name}: No env vars required`);
    return true; // Tool doesn't require any env vars
  }
  
  // For client-side, we'll need to check if the server has exposed these env vars
  let availableEnvVars = [];
  
  try {
    // For client-side, we can check window.__ENV__ if server exposes it
    const envVars = window.__ENV__ || {};
    // Only include env vars that are actually true (available)
    availableEnvVars = Object.keys(envVars).filter(key => envVars[key] === true);
    // console.log(`${tool.definition.name}: Checking required env vars:`, tool.requiredEnvVars);
    // console.log(`${tool.definition.name}: Available env vars:`, availableEnvVars);
  } catch (e) {
    console.warn(`${tool.definition.name}: Could not access environment variables:`, e);
    return false;
  }
  
  // Check if all required env vars are available
  const enabled = tool.requiredEnvVars.every(varName => availableEnvVars.includes(varName));
  // console.log(`${tool.definition.name}: Enabled = ${enabled}`);
  return enabled;
};

// Helper to get all tool definitions for the session update
export const getAllToolDefinitions = () => {
  try {
    // Filter tools to only include those with all required env vars available
    const enabledTools = Object.values(tools).filter(isToolEnabled);
    if (typeof window !== 'undefined') { // Only log in browser environment
      // console.log(`Enabled tools: ${enabledTools.map(t => t.definition.name).join(', ')}`);
    }
    
    return enabledTools.map(tool => tool.definition);
  } catch (error) {
    // Fallback in case of any errors during filtering
    console.warn("Error determining enabled tools:", error);
    return Object.values(tools).map(tool => tool.definition);
  }
};

// Helper function to map timezone abbreviations to full timezone strings
function getTimeZoneString(timezone) {
  const tzMap = {
    'utc': 'UTC',
    'est': 'America/New_York',
    'cst': 'America/Chicago',
    'mst': 'America/Denver',
    'pst': 'America/Los_Angeles',
    'local': Intl.DateTimeFormat().resolvedOptions().timeZone
  };
  
  return tzMap[timezone.toLowerCase()] || tzMap.local;
} 