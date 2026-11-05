/**
 * background.js — MV3 service worker
 * Roles:
 *  - create the "Start Picture-in-Picture" context menu
 *  - listen for keyboard shortcut (commands) for direct launch without opening popup
 * The popup (popup.js) handles manual selection and diagnostics; this file
 * only triggers the "auto" action via the same shared functions
 */
importScripts("shared/tab-actions.js");

const MENU_ID = "pip-pro-launch";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Start Picture-in-Picture",
    contexts: ["page", "video", "frame"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || tab.id == null) return;
  await triggerAutoPip(tab.id);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-pip") return;
  if (!tab || tab.id == null) return;
  await triggerAutoPip(tab.id);
});
