document.addEventListener("DOMContentLoaded", () => {
    const trackingList = document.getElementById("tracking-list");
    const resetButton = document.getElementById("resetData");
    const currentProjectDisplay = document.getElementById("currentProjectDisplay");

    // Elements for Category Selection (NEW)
    const activeProjectSelectPopup = document.getElementById("activeProjectSelectPopup");
    const newActiveProjectNamePopup = document.getElementById("newActiveProjectNamePopup");
    const setNewProjectBtn = document.getElementById("setNewProjectBtn");

    // Function to format milliseconds into a human-readable string (e.g., 1d 2h 3m 4s)
    function formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        let parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours % 24 > 0) parts.push(`${hours % 24}h`); // Hours remaining after days
        if (minutes % 60 > 0) parts.push(`${minutes % 60}m`); // Minutes remaining after hours
        if (seconds % 60 > 0) parts.push(`${seconds % 60}s`); // Seconds remaining after minutes

        // If total time is less than 1 second, display "0s"
        return parts.length > 0 ? parts.join(" ") : "0s";
    }

    // Function to display tracking data in the popup
    function displayTrackingData(data) {
        trackingList.innerHTML = ""; // Clear previous entries

        if (Object.keys(data).length === 0) {
            const li = document.createElement("li");
            li.textContent = "No tracking data yet. Start Browse or set a project!";
            trackingList.appendChild(li);
            return;
        }

        // Sort projects alphabetically for consistent display
        const sortedProjects = Object.keys(data).sort();

        sortedProjects.forEach((project) => {
            const totalTimeForProject = data[project];
            // Only display projects with actual time tracked (more than 0ms)
            if (totalTimeForProject > 0) {
                const projectItem = document.createElement("li");
                projectItem.className = "project-header"; // Apply styling for headers
                projectItem.innerHTML = `<strong>${project}</strong> <span class="time">${formatDuration(totalTimeForProject)}</span>`;
                trackingList.appendChild(projectItem);
            }
        });
    }

    // NEW Function to populate the project dropdown in the popup's "Change/Set Current Project" section
    function populateProjectDropdownPopup(selectElement, projects, currentActiveProject) {
        selectElement.innerHTML = ""; // Clear existing options

        // Add a default "Select..." option as the first item
        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = "--- Select or enter new ---";
        selectElement.appendChild(defaultOption);

        let currentProjectFoundInList = false;

        // Add all existing projects to the dropdown
        projects.forEach((project) => {
            const option = document.createElement("option");
            option.value = project;
            option.textContent = project;
            selectElement.appendChild(option);
            if (project === currentActiveProject) {
                currentProjectFoundInList = true;
            }
        });

        // Automatically select the current active project in the dropdown
        if (currentProjectFoundInList) {
            selectElement.value = currentActiveProject;
        } else if (currentActiveProject) {
            // If the current project is new/not in the pre-existing list, add it as a selected option
            // This can happen if a project was just added via the prompt and popup hasn't refreshed fully
            const newOption = document.createElement("option");
            newOption.value = currentActiveProject;
            newOption.textContent = currentActiveProject;
            selectElement.appendChild(newOption);
            selectElement.value = currentActiveProject;
        }
    }

    // Initial data load when the popup opens
    // Request all app state (tracking data, current project, available projects) from the background script
    chrome.runtime.sendMessage({ action: "getAllAppState" }, (response) => {
        if (response) {
            // Display tracked time data
            if (response.trackingData) {
                displayTrackingData(response.trackingData);
            } else {
                displayTrackingData({}); // Show empty state if no data
            }

            // Display the current active project
            const currentProject = response.currentProject || "General"; // Default to "General" if not set
            currentProjectDisplay.textContent = `Current Project: ${currentProject}`;

            // Populate the "Change/Set Current Project" dropdown in the popup
            populateProjectDropdownPopup(activeProjectSelectPopup, response.availableProjects || ["General"], currentProject);
        } else {
            // Error handling if no response from background script
            console.error("Popup: Failed to get app state or no response from background script. Check Service Worker console for errors.");
            currentProjectDisplay.textContent = "Current Project: N/A (Error)";
        }
    });

    // Event listener for the "Set New Category" button
    setNewProjectBtn.addEventListener("click", () => {
        let newProject = "";
        // Prioritize text input if user typed something there
        if (newActiveProjectNamePopup.value.trim() !== "") {
            newProject = newActiveProjectNamePopup.value.trim();
        } else if (activeProjectSelectPopup.value) {
            // Otherwise, use the selected value from the dropdown
            newProject = activeProjectSelectPopup.value;
        }

        if (newProject) {
            console.log("Popup: Attempting to send 'setProject' message with project:", newProject); // Debugging log
            chrome.runtime.sendMessage({ action: "setProject", project: newProject }, (response) => {
                console.log("Popup: Received response for 'setProject':", response); // Debugging log
                if (response && response.status === "ok") {
                    // Update the displayed current project
                    currentProjectDisplay.textContent = `Current Project: ${response.newProject}`;
                    // Refresh the dropdowns with potentially new project and re-select the new one
                    chrome.runtime.sendMessage({ action: "getAvailableProjects" }, (projResponse) => {
                        if (projResponse && projResponse.availableProjects) {
                            populateProjectDropdownPopup(activeProjectSelectPopup, projResponse.availableProjects, response.newProject);
                        }
                    });
                    newActiveProjectNamePopup.value = ""; // Clear the new project input field after successful set
                } else {
                    // Display a more specific error message if provided by background.js
                    const errorMessage = response && response.message ? response.message : "An unknown error occurred.";
                    console.error("Popup: Failed to set project:", response);
                    alert(`Error setting project: ${errorMessage} Please try again.`);
                }
            });
        } else {
            alert("Please select or enter a project to set as current.");
        }
    });

    // Event listener for the "Reset All Data" button
    resetButton.addEventListener("click", () => {
        if (confirm("Are you sure you want to reset all tracked data and projects? This cannot be undone.")) {
            chrome.runtime.sendMessage({ action: "resetAllData" }, (response) => {
                if (response && response.status === "ok") {
                    console.log("Popup: Tracking data and projects reset.");
                    displayTrackingData({}); // Immediately update UI to show empty state
                    currentProjectDisplay.textContent = "Current Project: General"; // Reset current project display
                    // Also reset the project selection dropdown to "General"
                    chrome.runtime.sendMessage({ action: "getAvailableProjects" }, (projResponse) => {
                        if (projResponse && projResponse.availableProjects) {
                            populateProjectDropdownPopup(activeProjectSelectPopup, projResponse.availableProjects, "General");
                        }
                    });
                } else {
                    console.error("Popup: Failed to reset data.");
                }
            });
        }
    });

    // Event listeners to clear the other input/selection when one is used in the category selection area
    newActiveProjectNamePopup.addEventListener("input", () => {
        activeProjectSelectPopup.value = ""; // Clear dropdown selection if user types
    });
    activeProjectSelectPopup.addEventListener("change", () => {
        newActiveProjectNamePopup.value = ""; // Clear text input if user selects from dropdown
    });
});
