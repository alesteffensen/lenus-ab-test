// ==UserScript==
// @name         Lenus A/B Testing Status Indicator (v1.0)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Add A/B Testing status indicator for Lenus pages
// @author       You
// @match        https://*.lenus.io/admin/coaches/*/setup/settings
// @match        https://*.lenus.io/admin/coaches/*/setup/forms/*
// @match        https://*.lenus.io/admin/*/edit
// @grant        GM_xmlhttpRequest
// @connect      docs.google.com
// @connect      spreadsheets.google.com
// @connect      googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        // Published CSV URL
        csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQEPez3FU4CCVsxmAF6boHbI63wfKMYN9CBV7HBbk9rRRJ24jraxplDKsFDONlm7tlt8cK-Gaefixg9/pub?output=csv',
        // Google Sheet URL for editing
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1hbUl_KWH_6z5DXv7I9w1IeMRofU8Mok1qi1b3Dr6eJU/edit?usp=sharing',
        // Column index (0-based) where coach IDs are stored
        idColumn: 0,
        // Refresh interval in milliseconds
        refreshInterval: 60000,
        // Initial delay for page load
        initialDelay: 500
    };

    // Get the current coach or form ID from the page
    function getCurrentId() {
        // Check if we're on the coach settings page
        const coachIdElement = Array.from(document.querySelectorAll('p.MuiTypography-root')).find(p =>
            p.textContent.includes('ID:')
        );

        if (coachIdElement) {
            // Extract ID from coach settings page
            const match = coachIdElement.textContent.match(/ID:\s*([a-f0-9-]+)/i);
            if (match && match[1]) return match[1].trim();
        }

        // Check if we're on the form edit page
        const previewLink = document.querySelector('a[data-testid="form-preview-link"]');
        if (previewLink) {
            // Extract ID from preview link URL
            const urlMatch = previewLink.href.match(/lenus\.io\/([^/]+)\//);
            if (urlMatch && urlMatch[1]) return urlMatch[1].trim();
        }

        // Check URL as a fallback for both pages
        const urlMatch = window.location.href.match(/\/([^/]+)\/(?:setup\/settings|edit)$/);
        if (urlMatch && urlMatch[1]) {
            return urlMatch[1].trim();
        }

        // Default fallback
        return '';
    }

    // Fetch the CSV data
    async function fetchCSVData() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: CONFIG.csvUrl,
                headers: {
                    'Accept': 'text/csv,*/*',
                    'Cache-Control': 'no-cache'
                },
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            // Parse CSV response
                            const rows = response.responseText
                                .split('\n')
                                .map(row => row.split(',').map(cell =>
                                    cell.trim().replace(/^"|"$/g, '') // Remove surrounding quotes
                                ))
                                .filter(row => row.length > 0); // Remove empty rows

                            resolve(rows);
                        } catch (parseError) {
                            console.error('CSV Parsing Error:', parseError);
                            reject(parseError);
                        }
                    } else {
                        reject(new Error(`Failed to fetch CSV: ${response.status}`));
                    }
                },
                onerror: function(error) {
                    console.error('CSV Fetch Error:', error);
                    reject(error);
                }
            });
        });
    }

    // Check if a coach ID is active based on the CSV data
    function isIdActive(csvData, coachId) {
        // Skip header row if it exists
        const dataRows = csvData.length > 1 ? csvData.slice(1) : csvData;

        // Check if the coach ID exists in the CSV (match is case-insensitive)
        return dataRows.some(row =>
            row[CONFIG.idColumn] &&
            row[CONFIG.idColumn].trim().toLowerCase() === coachId.toLowerCase()
        );
    }

    // Main function to add the A/B Testing status indicator
    function addABTestingStatusIndicator() {
        // Add the styles first
        addStyles();

        // Determine which page we're on
        const pageType = determinePageType();
        if (!pageType) {
            // Page not ready, retry later
            setTimeout(addABTestingStatusIndicator, 500);
            return;
        }

        // Remove existing pill if any
        const existingPill = document.getElementById('lenus-ab-testing-container');
        if (existingPill) {
            existingPill.remove();
        }

        // Insert the indicator in the appropriate location
        insertStatusIndicator(pageType);

        // Start checking the status
        checkABTestingStatus();
    }

    // Add CSS styles for the A/B Testing indicator
    function addStyles() {
        if (document.getElementById('lenus-ab-testing-styles')) return;

        const styleElement = document.createElement('style');
        styleElement.id = 'lenus-ab-testing-styles';
        styleElement.textContent = `
            .lenus-ab-pill {
                display: inline-flex;
                align-items: center;
                padding: 4px 12px;
                border-radius: 16px;
                font-size: 13px;
                font-weight: 500;
                height: 24px;
                width: fit-content;
            }

            .lenus-ab-link {
                display: inline-flex;
                margin-left: 6px;
                color: #000;
                cursor: pointer;
                align-items: center;
                vertical-align: middle;
            }

            .lenus-ab-link svg {
                display: block;
            }

            .lenus-ab-pill-enabled {
                background-color: rgba(16, 185, 129, 0.15);
                color: #047857;
            }

            .lenus-ab-pill-disabled {
                background-color: rgba(239, 68, 68, 0.15);
                color: #b91c1c;
            }

            .lenus-ab-pill-loading {
                background-color: rgba(176, 176, 176, 0.15);
                color: #666;
            }

            .lenus-ab-icon {
                margin-right: 8px;
            }

            /* Spinner animation */
            @keyframes lenus-ab-spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            /* Form page specific styles */
            .form-page .lenus-ab-testing-row {
                margin-bottom: 16px;
            }
        `;
        document.head.appendChild(styleElement);
    }

    // Determine which type of page we're on
    function determinePageType() {
        // Coach settings page
        const slugSection = Array.from(document.querySelectorAll('.css-1utqmw')).find(section =>
            section.querySelector('h6.MuiTypography-root') &&
            section.querySelector('h6.MuiTypography-root').textContent === 'Slug'
        );
        if (slugSection) return { type: 'coach', element: slugSection };

        // Form edit page
        const previewLinkSection = document.querySelector('.row.form-group:nth-child(1)');
        const scriptEmbedSection = document.querySelector('.row.form-group:nth-child(2)');
        if (previewLinkSection && scriptEmbedSection) {
            return {
                type: 'form',
                element: previewLinkSection.parentNode,
                insertBefore: scriptEmbedSection
            };
        }

        return null;
    }

    // Create and insert the status indicator
    function insertStatusIndicator(pageType) {
        const container = document.createElement('div');
        container.id = 'lenus-ab-testing-container';

        if (pageType.type === 'form') {
            // Form page layout
            container.className = 'row form-group form-group--small lenus-ab-testing-row';
            container.innerHTML = `
                <label class="input__label row__column row__column--2" style="display: flex; align-items: center;">
                    A/B Testing
                    <a href="${CONFIG.sheetUrl}" target="_blank" class="lenus-ab-link" title="Open A/B Testing Sheet">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M19 19H5V5H12V3H5C3.89 3 3 3.9 3 5V19C3 20.1 3.89 21 5 21H19C20.1 21 21 20.1 21 19V12H19V19ZM14 3V5H17.59L7.76 14.83L9.17 16.24L19 6.41V10H21V3H14Z" fill="currentColor"/>
                        </svg>
                    </a>
                </label>
                <div class="row__column">
                    <div class="lenus-ab-pill lenus-ab-pill-loading" id="lenus-ab-pill">
                        <svg class="lenus-ab-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" stroke-dasharray="30 30" stroke-dashoffset="25">
                                <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
                            </circle>
                        </svg>
                        <span id="lenus-ab-text">Checking...</span>
                    </div>
                </div>
            `;

            // Insert between preview link and script embed
            pageType.element.insertBefore(container, pageType.insertBefore);
            document.querySelector('.lenus-ab-testing-row').classList.add('form-page');

        } else {
            // Coach page layout
            container.className = 'css-1utqmw';
            container.innerHTML = `
                <div class="css-b95f0i">
                    <div class="css-hp68mp">
                        <h6 class="MuiTypography-root MuiTypography-subtitle2 css-y4s7ji" style="display: flex; align-items: center;">
                            A/B Testing
                            <a href="${CONFIG.sheetUrl}" target="_blank" class="lenus-ab-link" title="Open A/B Testing Sheet">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M19 19H5V5H12V3H5C3.89 3 3 3.9 3 5V19C3 20.1 3.89 21 5 21H19C20.1 21 21 20.1 21 19V12H19V19ZM14 3V5H17.59L7.76 14.83L9.17 16.24L19 6.41V10H21V3H14Z" fill="currentColor"/>
                                </svg>
                            </a>
                        </h6>
                    </div>
                </div>
                <div class="css-uq7dtg">
                    <div class="lenus-ab-pill lenus-ab-pill-loading" id="lenus-ab-pill">
                        <svg class="lenus-ab-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" stroke-dasharray="30 30" stroke-dashoffset="25">
                                <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
                            </circle>
                        </svg>
                        <span id="lenus-ab-text">Checking...</span>
                    </div>
                </div>
            `;

            // Insert before slug section
            pageType.element.parentNode.insertBefore(container, pageType.element);
        }
    }

    // Update the status display
    function updateStatusDisplay(isActive) {
        const pillElement = document.getElementById('lenus-ab-pill');
        const textElement = document.getElementById('lenus-ab-text');

        if (!pillElement || !textElement) return;

        if (isActive) {
            // Active state
            pillElement.className = 'lenus-ab-pill lenus-ab-pill-enabled';
            pillElement.innerHTML = `
                <svg class="lenus-ab-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor"/>
                </svg>
                <span>Active</span>
            `;
        } else {
            // Inactive state
            pillElement.className = 'lenus-ab-pill lenus-ab-pill-disabled';
            pillElement.innerHTML = `
                <svg class="lenus-ab-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" fill="currentColor"/>
                </svg>
                <span>Inactive</span>
            `;
        }
    }

    // Show error state
    function showErrorState() {
        const pillElement = document.getElementById('lenus-ab-pill');
        if (!pillElement) return;

        pillElement.className = 'lenus-ab-pill lenus-ab-pill-disabled';
        pillElement.innerHTML = `
            <svg class="lenus-ab-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/>
            </svg>
            <span>Error</span>
        `;
    }

    // Check A/B Testing status
    async function checkABTestingStatus() {
        try {
            const currentId = getCurrentId();

            if (!currentId) {
                console.error('Could not determine current ID');
                showErrorState();
                return;
            }

            const csvData = await fetchCSVData();
            const active = isIdActive(csvData, currentId);

            updateStatusDisplay(active);

            // Schedule next update
            setTimeout(checkABTestingStatus, CONFIG.refreshInterval);
        } catch (error) {
            console.error('Error checking A/B Testing status:', error);
            showErrorState();

            // Try again after a delay
            setTimeout(checkABTestingStatus, 30000);
        }
    }

    // Start with a minimal delay to ensure the page has loaded
    setTimeout(addABTestingStatusIndicator, CONFIG.initialDelay);

    // Add a mutation observer to handle React re-renders
    const observer = new MutationObserver(() => {
        if (!document.getElementById('lenus-ab-testing-container')) {
            setTimeout(addABTestingStatusIndicator, 500);
        }
    });

    // Start observing the container
    setTimeout(() => {
        const headerContainer = document.querySelector('.css-1iwoqsn')?.parentElement ||
                             document.querySelector('.row.form-group');
        if (headerContainer) {
            observer.observe(headerContainer, { childList: true, subtree: true });
        }
    }, 2000);
})();
