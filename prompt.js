document.addEventListener("DOMContentLoaded", async () => {
    const idleSection = document.getElementById("idleSection");
    const idleTimeDisplay = document.getElementById("idleTimeDisplay");
    const idleProjectSelect = document.getElementById("idleProjectSelect");
    const newIdleProjectNameInput = document.getElementById("newIdleProjectName");
    const addIdleTimeBtn = document.getElementById("addIdleTimeBtn");
    const discardIdleTimeBtn = document.getElementById("discardIdleTimeBtn");

    const activeProjectSelect = document.getElementById("activeProjectSelect");
    const newActiveProjectNameInput = document.getElementById("newActiveProjectName");
    const setProjectBtn = document.getElementById("setProjectBtn");

    let idleDuration = 0; // Will be populated from storage

    // --- Helper Functions ---

    function formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        let parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours % 24 > 0) parts.push(`${hours % 24}h`);
        if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);
        if (seconds % 60 > 0) parts.push(`${seconds % 60}s`);

        return parts.length > 0 ? parts.join(" ") : "0s";
    }

    function populateProjectDropdown(selectElement, projects) {
        selectElement.innerHTML = ""; // Clear existing options

        // Add a default "Select..." option for better UX
        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = "--- Select or enter new ---";
        selectElement.appendChild(defaultOption);

        let generalOptionFound = false;

        // Add all projects from the list
        projects.forEach((project) => {
            const option = document.createElement("option");
            option.value = project;
            option.textContent = project;
            selectElement.appendChild(option);
            if (project === "General") {
                generalOptionFound = true;
            }
        });

        // Automatically select 'General' if it exists in the list
        if (generalOptionFound) {
            selectElement.value = "General"; // Set the value to 'General' to select it
        }
    }

    // --- Initialize UI and Data ---

    // Get idle duration from session storage
    const result = await chrome.storage.session.get("idleDuration");
    idleDuration = result.idleDuration || 0;

    // Get available projects from background script
    chrome.runtime.sendMessage({ action: "getAvailableProjects" }, (response) => {
        if (response && response.availableProjects) {
            populateProjectDropdown(idleProjectSelect, response.availableProjects);
            populateProjectDropdown(activeProjectSelect, response.availableProjects);
        }
    });

    if (idleDuration > 0) {
        idleSection.style.display = "block"; // Show idle section
        idleTimeDisplay.textContent = formatDuration(idleDuration);
    } else {
        idleSection.style.display = "none"; // Hide if no idle time
    }

    // --- Event Listeners ---

    let idleAction = "discard"; // Default action for idle time (if user doesn't interact)
    let chosenIdleProject = null;
    let nextActiveProject = "";

    addIdleTimeBtn.addEventListener("click", () => {
        let project = "";
        if (newIdleProjectNameInput.value.trim() !== "") {
            project = newIdleProjectNameInput.value.trim();
        } else if (idleProjectSelect.value) {
            project = idleProjectSelect.value;
        }

        if (project) {
            idleAction = "categorize";
            chosenIdleProject = project;
            // Visually give feedback that this section is handled
            idleSection.style.opacity = 0.5;
            idleSection.style.pointerEvents = "none"; // Disable interactions
            addIdleTimeBtn.textContent = "Time Added!";
            addIdleTimeBtn.style.backgroundColor = "#007bff"; // Change color
            discardIdleTimeBtn.style.display = "none"; // Hide discard button
            alert(`Idle time will be added to "${chosenIdleProject}". Please select your current activity and click 'Start Tracking Now'.`);
        } else {
            alert("Please select or enter a project for your idle time.");
        }
    });

    discardIdleTimeBtn.addEventListener("click", () => {
        idleAction = "discard";
        chosenIdleProject = null;
        // Visually give feedback that this section is handled
        idleSection.style.opacity = 0.5;
        idleSection.style.pointerEvents = "none"; // Disable interactions
        discardIdleTimeBtn.textContent = "Time Discarded!";
        discardIdleTimeBtn.style.backgroundColor = "#dc3545"; // Change color
        addIdleTimeBtn.style.display = "none"; // Hide add button
        alert("Idle time will be discarded. Please select your current activity and click 'Start Tracking Now'.");
    });

    setProjectBtn.addEventListener("click", () => {
        if (newActiveProjectNameInput.value.trim() !== "") {
            nextActiveProject = newActiveProjectNameInput.value.trim();
        } else if (activeProjectSelect.value) {
            nextActiveProject = activeProjectSelect.value;
        }

        if (nextActiveProject) {
            // Send the combined response to the background script
            chrome.runtime.sendMessage(
                {
                    action: "handlePromptResponse",
                    idleAction: idleAction, // "categorize" or "discard"
                    idleProject: chosenIdleProject, // project name if categorized, null otherwise
                    nextActiveProject: nextActiveProject, // the project for ongoing active tracking
                },
                (response) => {
                    if (response && response.status === "ok") {
                        window.close(); // Close the prompt window on success
                    } else {
                        console.error("Failed to set project from prompt:", response);
                        alert("Error setting projects. Please try again.");
                    }
                }
            );
        } else {
            alert("Please select or enter a project for your current activity.");
        }
    });

    // Handle Enter key for new project inputs (for convenience)
    newIdleProjectNameInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            e.preventDefault(); // Prevent form submission
            addIdleTimeBtn.click();
        }
    });

    newActiveProjectNameInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            e.preventDefault(); // Prevent form submission
            setProjectBtn.click();
        }
    });

    // Clear other input/selection when one is used
    newIdleProjectNameInput.addEventListener("input", () => (idleProjectSelect.value = ""));
    idleProjectSelect.addEventListener("change", () => (newIdleProjectNameInput.value = ""));
    newActiveProjectNameInput.addEventListener("input", () => (activeProjectSelect.value = ""));
    activeProjectSelect.addEventListener("change", () => (newActiveProjectNameInput.value = ""));
});
