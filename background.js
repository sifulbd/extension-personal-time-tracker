let activeTabId = null;
let lastActiveTime = Date.now(); // Timestamp of when the active state last changed
let trackingData = {}; // Format: { "ProjectName": totalTimeInMs }
let availableProjects = ["General"]; // Default starting project
let currentProject = "General"; // Currently active project for tracking

let needsProjectPrompt = false; // Flag to trigger project prompt when user becomes active
let idleStartTime = null; // To store when the idle period began

// --- Storage Management Functions ---

// Function to save all relevant state to local storage
async function saveAppState() {
    await chrome.storage.local.set({ trackingData, availableProjects, currentProject });
    // console.log("App state saved:", { trackingData, availableProjects, currentProject });
}

// Function to load all relevant state from local storage
async function loadAppState() {
    const result = await chrome.storage.local.get(["trackingData", "availableProjects", "currentProject"]);
    trackingData = result.trackingData || {};
    availableProjects = result.availableProjects || ["General"];
    currentProject = result.currentProject || "General";

    // Ensure 'General' project exists in trackingData if it's the current one
    if (!trackingData[currentProject]) {
        trackingData[currentProject] = 0; // Initialize project time to 0
    }
    // console.log("App state loaded:", { trackingData, availableProjects, currentProject });
}

// Initialize: Load data when the service worker starts
loadAppState();

// --- Core Tracking Logic ---

// Helper to update time for the currently active project
function updateActiveTime() {
    if (currentProject) {
        // Ensure currentProject is set
        const currentTime = Date.now();
        const duration = currentTime - lastActiveTime;

        // Only track if duration is meaningful (e.g., > 1 second)
        if (duration > 1000) {
            if (!trackingData[currentProject]) {
                trackingData[currentProject] = 0; // Initialize project time to 0
            }
            trackingData[currentProject] += duration;
        }
    }
    lastActiveTime = Date.now(); // Reset for the next interval
    saveAppState(); // Save data frequently
}

// --- Event Listeners for Tracking ---
// These listeners define when the user is "active" in the browser.

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    updateActiveTime(); // Update time for the previously active project
    activeTabId = activeInfo.tabId;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tabId === activeTabId && tab.active) {
        updateActiveTime(); // Update time for the current project
    }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
    updateActiveTime(); // Update time for the previously active context

    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        activeTabId = null; // No active tab in Chrome
    } else {
        const [tab] = await chrome.tabs.query({ active: true, windowId: windowId });
        if (tab) {
            activeTabId = tab.id;
        }
    }
    lastActiveTime = Date.now();
    saveAppState();
});

// --- Idle Detection and Project Prompt ---

chrome.idle.setDetectionInterval(60); // Check for idle every 60 seconds (minimum is 15 seconds)

chrome.idle.onStateChanged.addListener(async (newState) => {
    updateActiveTime(); // Apply any time from the period just before idle/active change

    if (newState === "idle" || newState === "locked") {
        // User is idle or computer is locked, stop active tracking
        activeTabId = null; // No active tab for tracking
        needsProjectPrompt = true; // Flag to prompt when active again
        idleStartTime = Date.now(); // Record when idle started
        // console.log("User is idle or locked. Prompt flagged. Idle started:", new Date(idleStartTime));
    } else {
        // newState === "active"
        // User became active again
        if (needsProjectPrompt) {
            const currentTime = Date.now();
            const idleDuration = idleStartTime ? currentTime - idleStartTime : 0;
            idleStartTime = null; // Reset idle start time

            // Store idle duration temporarily in session storage for the prompt
            await chrome.storage.session.set({ idleDuration: idleDuration });

            openProjectPrompt(); // Open prompt to ask about idle time and new project
            needsProjectPrompt = false; // Reset flag
            // console.log("User became active. Opening project prompt. Idle duration:", idleDuration);
        }

        // Re-identify active tab and reset lastActiveTime *after* prompt is handled
        // This part will be handled by the message from prompt.js after project is set
    }
    saveAppState();
});

// Function to open the project prompt window
function openProjectPrompt() {
    chrome.windows.create(
        {
            url: chrome.runtime.getURL("prompt.html"),
            type: "popup",
            width: 450, // Increased width to accommodate more info
            height: 350, // Increased height
            focused: true,
        },
        (win) => {
            // Optional: store window ID if you need to close it programmatically later
            // console.log("Prompt window opened with ID:", win.id);
        }
    );
}

// --- Message Listener for Communication with Popup/Prompt ---

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === "getAllAppState") {
        sendResponse({
            trackingData: trackingData,
            availableProjects: availableProjects,
            currentProject: currentProject,
        });
        return true; // Important: Return true for asynchronous response
    } else if (request.action === "setProject") {
        // THIS IS THE HANDLER USED BY THE POPUP NOW
        const newProject = request.project;
        console.log("Background: Received 'setProject' message for project:", newProject); // Logging
        if (newProject && newProject.trim() !== "") {
            updateActiveTime(); // Apply any pending time to old project before switching

            currentProject = newProject.trim();
            if (!availableProjects.includes(currentProject)) {
                availableProjects.push(currentProject);
                availableProjects.sort(); // Keep sorted alphabetically
            }
            // Ensure the new project has an entry in trackingData if it's brand new
            if (!trackingData[currentProject]) {
                trackingData[currentProject] = 0; // Initialize time for new project
            }
            saveAppState();
            console.log("Background: Successfully set currentProject to:", currentProject); // Logging
            sendResponse({ status: "ok", newProject: currentProject }); // Send back the actual new project name
        } else {
            console.warn("Background: 'setProject' received with invalid project name:", newProject); // Logging
            sendResponse({ status: "error", message: "Invalid project name provided." });
        }
        return true; // Important for asynchronous sendResponse calls
    } else if (request.action === "handlePromptResponse") {
        const { idleAction, idleProject, nextActiveProject } = request;
        const idleDurationFromPrompt = await chrome.storage.session.get("idleDuration");
        const actualIdleDuration = idleDurationFromPrompt.idleDuration || 0;
        await chrome.storage.session.remove("idleDuration"); // Clear temporary storage

        // 1. Handle idle time based on user's choice
        if (idleAction === "categorize" && idleProject && actualIdleDuration > 0) {
            if (!trackingData[idleProject]) {
                trackingData[idleProject] = 0;
            }
            trackingData[idleProject] += actualIdleDuration;
            // console.log(`Idle time (${actualIdleDuration}ms) added to project: ${idleProject}`);
        } else if (idleAction === "discard") {
            // Idle time is already not counted for current active project, so nothing to do here
            // console.log("Idle time discarded.");
        }

        // 2. Set the next active project for ongoing tracking
        if (nextActiveProject && nextActiveProject.trim() !== "") {
            currentProject = nextActiveProject.trim();
            if (!availableProjects.includes(currentProject)) {
                availableProjects.push(currentProject);
                availableProjects.sort();
            }
            if (!trackingData[currentProject]) {
                trackingData[currentProject] = 0;
            }
            // console.log("Next active project set to:", currentProject);
        } else {
            // Fallback if no next project is selected (e.g., user closes prompt without choosing)
            currentProject = "General";
            // console.log("No next active project chosen, defaulting to General.");
        }

        // After handling the prompt, reset active tab and lastActiveTime to start new active tracking
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                activeTabId = tabs[0].id;
                lastActiveTime = Date.now(); // Start counting from now
                // console.log("Tracking restarted for new active project.");
            }
        });

        saveAppState();
        sendResponse({ status: "ok" });
        return true; // Important: Return true for asynchronous response
    } else if (request.action === "getAvailableProjects") {
        sendResponse({ availableProjects: availableProjects });
        return true; // Important: Return true for asynchronous response
    } else if (request.action === "resetAllData") {
        trackingData = {};
        availableProjects = ["General"];
        currentProject = "General";
        saveAppState();
        sendResponse({ status: "ok" });
        return true; // Important: Return true for asynchronous response
    }
    // If no action matched, no response is sent, so no 'return true' is needed here.
    // The default return for listeners without sendResponse is false, which is fine.
});

// Periodically save data to ensure persistence even if browser crashes
setInterval(saveAppState, 30000); // Save every 30 seconds
