import { useState } from "react";
import { CloudLightning, CloudOff, MessageSquare } from "react-feather";
import Button from "./Button";

function SessionStopped({ startSession }) {
  const [isActivating, setIsActivating] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState("verse"); // Default voice
  const [instructions, setInstructions] = useState(
    `You are a helpful assistant with access to several tools.

Be proactive about using these tools when they would help answer a question.

For the clipboard tool, use the function "clipboard_manager" with the "save" action to store data when a user says things like "copy this" or "save this to clipboard".

IMPORTANT: For webhook calls, follow these rules exactly:
1. Always trigger the webhook FIRST before providing any explanation
2. Always use the "webhook_call" function with these exact fields:
   - "method": The HTTP method (GET or POST)
   - "endpoint_key": The exact webhook name
   - "payload": ALL parameters go here (for both GET and POST)
❗ Never use "data", "body", "query_params", or other fields — only "payload".

✅ Example for GET:
{
  "method": "GET",
  "endpoint_key": "weather-api",
  "payload": {
    "latitude": 40.7128,
    "longitude": -74.006,
    "current_weather": true
  }
}

✅ Example for POST:
{
  "endpoint_key": "n8n-brave-search",
  "method": "POST",
  "payload": {
    "query": "the latest in AI news"
  }
}

When in doubt, prefer using a tool to answer the user's request, and follow the exact field structure defined in the tool's parameters.`
  ); // Default system prompt

  // Default instructions text for reset button
  const defaultInstructions = `You are a helpful assistant with access to several tools.

Be proactive about using these tools when they would help answer a question.

For the clipboard tool, use the function "clipboard_manager" with the "save" action to store data when a user says things like "copy this" or "save this to clipboard".

IMPORTANT: For webhook calls, follow these rules exactly:
1. Always trigger the webhook FIRST before providing any explanation
2. Always use the "webhook_call" function with these exact fields:
   - "method": The HTTP method (GET or POST)
   - "endpoint_key": The exact webhook name
   - "payload": ALL parameters go here (for both GET and POST)
❗ Never use "data", "body", "query_params", or other fields — only "payload".

✅ Example for GET:
{
  "method": "GET",
  "endpoint_key": "weather-api",
  "payload": {
    "latitude": 40.7128,
    "longitude": -74.006,
    "current_weather": true
  }
}

✅ Example for POST:
{
  "endpoint_key": "n8n-brave-search",
  "method": "POST",
  "payload": {
    "query": "the latest in AI news"
  }
}

When in doubt, prefer using a tool to answer the user's request, and follow the exact field structure defined in the tool's parameters.`;

  const voices = [
    { id: "alloy", name: "Alloy (Female)" },
    { id: "ash", name: "Ash (Male)" },
    { id: "ballad", name: "Ballad (Male)" },
    { id: "coral", name: "Coral (Female)" },
    { id: "echo", name: "Echo (Male)" },
    { id: "sage", name: "Sage (Female)" },
    { id: "shimmer", name: "Shimmer (Female)" },
    { id: "verse", name: "Verse (Male)" },
  ];

  function handleStartSession() {
    if (isActivating) return;

    setIsActivating(true);
    startSession(selectedVoice, instructions); // Pass system prompt to startSession
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-full gap-3">
      <div className="flex items-center gap-2 mb-2">
        <label htmlFor="voice-select" className="text-sm text-secondary-700 dark:text-dark-text-secondary">
          Voice:
        </label>
        <select
          id="voice-select"
          value={selectedVoice}
          onChange={(e) => setSelectedVoice(e.target.value)}
          disabled={isActivating}
          className="px-2 py-1 text-sm rounded border border-secondary-200 dark:border-dark-border bg-white dark:bg-dark-surface dark:text-dark-text"
        >
          {voices.map(voice => (
            <option key={voice.id} value={voice.id}>
              {voice.name}
            </option>
          ))}
        </select>
      </div>
      
      <div className="w-full max-w-xl mb-2">
        <div className="flex justify-between items-center mb-1">
          <label htmlFor="instructions" className="block text-sm text-secondary-700 dark:text-dark-text-secondary">
            System Instructions:
          </label>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setInstructions("")} 
              className="text-xs text-gray-600 dark:text-gray-400 hover:underline"
              disabled={isActivating}
            >
              Clear
            </button>
            <button 
              onClick={() => setInstructions(defaultInstructions)} 
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              disabled={isActivating}
            >
              Reset to Default
            </button>
          </div>
        </div>
        <textarea
          id="instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          disabled={isActivating}
          placeholder="Enter system instructions..."
          className="w-full px-2 py-1 text-sm rounded border border-secondary-200 dark:border-dark-border bg-white dark:bg-dark-surface dark:text-dark-text h-24 resize-none"
        />
      </div>
      
      <button
        onClick={handleStartSession}
        disabled={isActivating}
        className={`flex items-center gap-2 px-6 py-3 font-medium text-white rounded shadow-md transition-colors ${
          isActivating 
            ? "bg-gray-600 dark:bg-gray-700 cursor-not-allowed" 
            : "bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800"
        }`}
      >
        <CloudLightning size={18} />
        {isActivating ? "Starting session..." : "Start session"}
      </button>
    </div>
  );
}

function SessionActive({ stopSession, sendTextMessage }) {
  const [message, setMessage] = useState("");

  function handleSendClientEvent() {
    sendTextMessage(message);
    setMessage("");
  }

  return (
    <div className="flex items-center justify-center w-full h-full gap-4">
      <input
        onKeyDown={(e) => {
          if (e.key === "Enter" && message.trim()) {
            handleSendClientEvent();
          }
        }}
        type="text"
        placeholder="send a text message..."
        className="border border-gray-200 dark:border-gray-600 rounded-full p-4 flex-1 dark:bg-gray-700 dark:text-white"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <Button
        onClick={() => {
          if (message.trim()) {
            handleSendClientEvent();
          }
        }}
        icon={<MessageSquare height={16} />}
        className="bg-blue-400 dark:bg-blue-600"
      >
        send text
      </Button>
      <Button 
        onClick={stopSession} 
        icon={<CloudOff height={16} />}
        className="dark:bg-gray-700"
      >
        disconnect
      </Button>
    </div>
  );
}

export default function SessionControls({
  startSession,
  stopSession,
  sendClientEvent,
  sendTextMessage,
  serverEvents,
  isSessionActive,
  className = "",
}) {
  return (
    <div className={`flex gap-4 h-full rounded-md ${className}`}>
      {isSessionActive ? (
        <SessionActive
          stopSession={stopSession}
          sendClientEvent={sendClientEvent}
          sendTextMessage={sendTextMessage}
          serverEvents={serverEvents}
        />
      ) : (
        <SessionStopped startSession={startSession} />
      )}
    </div>
  );
}
