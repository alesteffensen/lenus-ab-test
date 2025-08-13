// ==UserScript==
// @name         Lenus A/B Testing Status Indicator (v1.1)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Add A/B Testing status indicator for Lenus pages (Dynamic Island style)
// @author       You
// @match        https://*.lenus.io/admin/coaches/*/setup/settings
// @match        https://*.lenus.io/admin/coaches/*/setup/forms/*
// @match        https://*.lenus.io/admin/*/edit
// @grant        GM_xmlhttpRequest
// @connect      docs.google.com
// @connect      spreadsheets.google.com
// @connect      googleusercontent.com
// @updateURL    https://github.com/alesteffensen/lenus-ab-test/raw/refs/heads/main/lenus-ab-testing.user.js
// @downloadURL  https://github.com/alesteffensen/lenus-ab-test/raw/refs/heads/main/lenus-ab-testing.user.js
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQEPez3FU4CCVsxmAF6boHbI63wfKMYN9CBV7HBbk9rRRJ24jraxplDKsFDONlm7tlt8cK-Gaefixg9/pub?output=csv',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1hbUl_KWH_6z5DXv7I9w1IeMRofU8Mok1qi1b3Dr6eJU/edit?usp=sharing',
        idColumn: 0,
        refreshInterval: 60000,
        initialDelay: 500
    };

    function getCurrentId() {
        const coachIdElement = Array.from(document.querySelectorAll('p.MuiTypography-root')).find(p =>
            p.textContent.includes('ID:')
        );
        if (coachIdElement) {
            const match = coachIdElement.textContent.match(/ID:\s*([a-f0-9-]+)/i);
            if (match && match[1]) return match[1].trim();
        }

        const previewLink = document.querySelector('a[data-testid="form-preview-link"]');
        if (previewLink) {
            const urlMatch = previewLink.href.match(/lenus\.io\/([^/]+)\//);
            if (urlMatch && urlMatch[1]) return urlMatch[1].trim();
        }

        const urlMatch = window.location.href.match(/\/([^/]+)\/(?:setup\/settings|edit)$/);
        if (urlMatch && urlMatch[1]) return urlMatch[1].trim();

        return '';
    }

    async function fetchCSVData() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: CONFIG.csvUrl,
                headers: { 'Accept': 'text/csv,*/*', 'Cache-Control': 'no-cache' },
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            const rows = response.responseText
                                .split('\n')
                                .map(row => row.split(',').map(cell => cell.trim().replace(/^"|"$/g, '')))
                                .filter(row => row.length > 0);
                            resolve(rows);
                        } catch (parseError) {
                            reject(parseError);
                        }
                    } else {
                        reject(new Error(`Failed to fetch CSV: ${response.status}`));
                    }
                },
                onerror: reject
            });
        });
    }

    function isIdActive(csvData, coachId) {
        const dataRows = csvData.length > 1 ? csvData.slice(1) : csvData;
        return dataRows.some(row =>
            row[CONFIG.idColumn] &&
            row[CONFIG.idColumn].trim().toLowerCase() === coachId.toLowerCase()
        );
    }

    function addStyles() {
        if (document.getElementById('lenus-ab-testing-styles')) return;

        const styleElement = document.createElement('style');
        styleElement.id = 'lenus-ab-testing-styles';
        styleElement.textContent = `
            .lenus-ab-pill {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 13px;
                font-weight: 500;
                min-height: 16px;
                position: relative;
                overflow: hidden;
                transition: all 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }

            .lenus-ab-pill.loading {
                width: 95px;
                background-color: rgba(107, 114, 128, 0.1);
                color: rgb(75, 85, 99);
            }

            .lenus-ab-pill.active {
                width: 70px;
                background-color: rgba(34, 197, 94, 0.1);
                color: rgb(21, 128, 61);
            }

            .lenus-ab-pill.inactive {
                width: 76px;
                background-color: rgba(239, 68, 68, 0.1);
                color: rgb(185, 28, 28);
            }

            .lenus-ab-pill.error {
                width: 64px;
                background-color: rgba(245, 158, 11, 0.1);
                color: rgb(146, 64, 14);
            }

            .lenus-ab-pill-content {
                display: flex;
                align-items: center;
                gap: 8px;
                position: absolute;
                left: 16px;
                top: 50%;
                transform: translateY(-50%);
                transition: opacity 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            }

            .lenus-ab-pill-content.fade-out {
                opacity: 0;
            }

            .lenus-ab-icon {
                width: 14px;
                height: 14px;
                flex-shrink: 0;
            }

            .lenus-ab-spinner {
                animation: lenus-ab-spin 1s linear infinite;
            }

            @keyframes lenus-ab-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }

            .lenus-ab-link {
                display: inline-flex;
                margin-left: 6px;
                color: rgb(107, 114, 128);
                cursor: pointer;
                align-items: center;
                transition: color 0.2s ease;
            }

            .lenus-ab-link:hover {
                color: rgb(59, 130, 246);
            }

            .lenus-ab-link svg {
                display: block;
                width: 14px;
                height: 14px;
            }

            .form-page .lenus-ab-testing-row {
                margin-bottom: 16px;
            }
        `;
        document.head.appendChild(styleElement);
    }

    function determinePageType() {
        const infoSection = Array.from(document.querySelectorAll('.css-yd8sa2')).find(section => {
            const heading = section.querySelector('h6.MuiTypography-h6');
            return heading && heading.textContent === 'Info';
        });
        
        if (infoSection) return { type: 'coach', element: infoSection };

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

    function insertStatusIndicator(pageType) {
        const container = document.createElement('div');
        container.id = 'lenus-ab-testing-container';

        if (pageType.type === 'form') {
            container.className = 'row form-group form-group--small lenus-ab-testing-row';
            container.innerHTML = `
                <label class="input__label row__column row__column--2" style="display: flex; align-items: center;">
                    A/B Testing
                    <a href="${CONFIG.sheetUrl}" target="_blank" class="lenus-ab-link" title="Open A/B Testing Sheet">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M19 19H5V5H12V3H5C3.89 3 3 3.9 3 5V19C3 20.1 3.89 21 5 21H19C20.1 21 21 20.1 21 19V12H19V19ZM14 3V5H17.59L7.76 14.83L9.17 16.24L19 6.41V10H21V3H14Z" fill="currentColor"/>
                        </svg>
                    </a>
                </label>
                <div class="row__column">
                    <div class="lenus-ab-pill loading" id="lenus-ab-pill">
                        <div class="lenus-ab-pill-content" id="lenus-ab-content">
                            <svg class="lenus-ab-icon lenus-ab-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <path d="M21 12a9 9 0 11-6.219-8.56"/>
                            </svg>
                            <span>Checking...</span>
                        </div>
                    </div>
                </div>
            `;
            pageType.element.insertBefore(container, pageType.insertBefore);
            document.querySelector('.lenus-ab-testing-row').classList.add('form-page');
        } else {
            container.className = 'css-1utqmw';
            container.innerHTML = `
                <div class="css-b95f0i">
                    <div class="css-hp68mp">
                        <h6 class="MuiTypography-root MuiTypography-subtitle2 css-ajt7oo" style="display: flex; align-items: center;">
                            A/B Testing
                            <a href="${CONFIG.sheetUrl}" target="_blank" class="lenus-ab-link" title="Open A/B Testing Sheet">
                                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M19 19H5V5H12V3H5C3.89 3 3 3.9 3 5V19C3 20.1 3.89 21 5 21H19C20.1 21 21 20.1 21 19V12H19V19ZM14 3V5H17.59L7.76 14.83L9.17 16.24L19 6.41V10H21V3H14Z" fill="currentColor"/>
                                </svg>
                            </a>
                        </h6>
                    </div>
                </div>
                <div class="css-uq7dtg">
                    <div class="lenus-ab-pill loading" id="lenus-ab-pill">
                        <div class="lenus-ab-pill-content" id="lenus-ab-content">
                            <svg class="lenus-ab-icon lenus-ab-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <path d="M21 12a9 9 0 11-6.219-8.56"/>
                            </svg>
                            <span>Checking...</span>
                        </div>
                    </div>
                </div>
            `;

            const infoContainer = pageType.element.querySelector('.css-j7qwjs:last-child .css-yd8sa2');
            if (infoContainer && infoContainer.firstChild) {
                infoContainer.insertBefore(container, infoContainer.firstChild);
            } else if (infoContainer) {
                infoContainer.appendChild(container);
            }
        }
    }

    const states = {
        loading: {
            icon: `<svg class="lenus-ab-icon lenus-ab-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                     <path d="M21 12a9 9 0 11-6.219-8.56"/>
                   </svg>`,
            text: 'Checking...',
            className: 'loading'
        },
        active: {
            icon: `<svg class="lenus-ab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                     <polyline points="20,6 9,17 4,12"></polyline>
                   </svg>`,
            text: 'Active',
            className: 'active'
        },
        inactive: {
            icon: `<svg class="lenus-ab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                     <line x1="18" y1="6" x2="6" y2="18"></line>
                     <line x1="6" y1="6" x2="18" y2="18"></line>
                   </svg>`,
            text: 'Inactive',
            className: 'inactive'
        },
        error: {
            icon: `<svg class="lenus-ab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                     <circle cx="12" cy="12" r="10"></circle>
                     <line x1="12" y1="8" x2="12" y2="12"></line>
                     <line x1="12" y1="16" x2="12.01" y2="16"></line>
                   </svg>`,
            text: 'Error',
            className: 'error'
        }
    };

    let currentState = null;
    let isFirstCheck = true;

    function setState(newState) {
        const pill = document.getElementById('lenus-ab-pill');
        const content = document.getElementById('lenus-ab-content');
        if (!pill || !content) return;

        // Don't animate if state hasn't changed
        if (currentState === newState) return;
        
        const state = states[newState];
        currentState = newState;
        
        pill.className = `lenus-ab-pill ${state.className}`;
        content.classList.add('fade-out');
        
        setTimeout(() => {
            content.innerHTML = `${state.icon}<span>${state.text}</span>`;
            setTimeout(() => content.classList.remove('fade-out'), 50);
        }, 125);
    }

    async function checkABTestingStatus() {
        try {
            const currentId = getCurrentId();
            if (!currentId) {
                setState('error');
                return;
            }

            // Only show loading on first check
            if (isFirstCheck) {
                setState('loading');
                isFirstCheck = false;
            }

            const csvData = await fetchCSVData();
            const active = isIdActive(csvData, currentId);
            setState(active ? 'active' : 'inactive');
            setTimeout(checkABTestingStatus, CONFIG.refreshInterval);
        } catch (error) {
            setState('error');
            setTimeout(checkABTestingStatus, 30000);
        }
    }

    function init() {
        addStyles();
        const pageType = determinePageType();
        if (!pageType) {
            setTimeout(init, 500);
            return;
        }

        const existingIndicator = document.getElementById('lenus-ab-testing-container');
        if (existingIndicator) existingIndicator.remove();

        insertStatusIndicator(pageType);
        checkABTestingStatus();
    }

    setTimeout(init, CONFIG.initialDelay);

    const observer = new MutationObserver(() => {
        if (!document.getElementById('lenus-ab-testing-container')) {
            setTimeout(init, 500);
        }
    });

    setTimeout(() => {
        const headerContainer = document.querySelector('.css-yd8sa2') || document.querySelector('.row.form-group');
        if (headerContainer) {
            observer.observe(headerContainer, { childList: true, subtree: true });
        }
    }, 2000);
})();
