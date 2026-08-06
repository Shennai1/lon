/*
 * Instagram Web Ad Filter for Surge
 * Version 1.3.4
 *
 * Observes high-confidence ad objects in selected Instagram JSON responses,
 * but never changes their bodies. Rendered ads are covered by stateless CSS
 * only when their article contains Instagram's exact ad redirect URL. The
 * article keeps its layout size so Instagram's virtual list stays intact.
 * Every matched response gets a diagnostic response header:
 *
 *   X-Surge-IG-Ad-Filter: ran; mode=observe-only; detected=N
 *
 * Surge's debug log also receives a line beginning with [IG Ad Filter].
 */

(function () {
  "use strict";

  var STATS_KEY = "ig_ad_filter_stats_v3";
  var MAX_DEPTH = 20;
  var MAX_VISITED_NODES = 150000;
  var detected = 0;
  var visited = 0;
  var reasons = {};
  var detectedPaths = [];

  var HTML_MARKER = "data-surge-ig-ad-filter=\"1\"";

  function htmlInjectionPayload() {
    var selector = "a[href*=\"facebook.com/ads/ig_redirect/\"]," +
      "a[href*=\"instagram.com/ads/ig_redirect/\"]";
    var adArticle = "article:has(" + selector + ")";
    var style = "<style " + HTML_MARKER + ">" +
      adArticle + "{position:relative!important}" +
      adArticle + ">*{visibility:hidden!important}" +
      adArticle + "::after{" +
      "content:'已隐藏一条赞助内容';" +
      "visibility:visible!important;" +
      "position:absolute!important;inset:0!important;" +
      "display:flex!important;align-items:center!important;justify-content:center!important;" +
      "background:Canvas!important;color:GrayText!important;" +
      "font:14px -apple-system,BlinkMacSystemFont,sans-serif!important;" +
      "z-index:2147483647!important;pointer-events:auto!important}" +
      "</style>";
    return style;
  }

  function injectHtml(body) {
    if (body.indexOf(HTML_MARKER) !== -1) return "";
    var payload = htmlInjectionPayload();
    var lowerBody = body.toLowerCase();
    var headEnd = lowerBody.lastIndexOf("</head>");
    if (headEnd !== -1) {
      return body.slice(0, headEnd) + payload + body.slice(headEnd);
    }
    return payload + body;
  }

  // These arrays represent individual timeline/feed records in the current
  // Instagram Web response shapes. Do not deep-match generic arrays such as
  // `instructions`: one instruction may contain the entire timeline.
  var ENTRY_ARRAY_KEYS = {
    edges: true,
    entries: true,
    feed_items: true,
    items: true,
    nodes: true,
    timeline_items: true
  };

  function isObject(value) {
    return value !== null && typeof value === "object";
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function isMeaningful(value) {
    return value !== undefined && value !== null && value !== false &&
      value !== 0 && value !== "" && value !== "0" && value !== "none";
  }

  function lower(value) {
    return typeof value === "string" ? value.toLowerCase() : "";
  }

  function markedAdReason(object) {
    if (!isObject(object) || Array.isArray(object)) {
      return "";
    }

    if (hasOwn(object, "ad_id") && isMeaningful(object.ad_id)) return "ad_id";
    if (hasOwn(object, "ad_action_url") && isMeaningful(object.ad_action_url)) return "ad_action_url";
    if (hasOwn(object, "ad_title") && isMeaningful(object.ad_title)) return "ad_title";
    if (hasOwn(object, "ad_link_type") && isMeaningful(object.ad_link_type)) return "ad_link_type";
    // Current Instagram Web timeline edges use `node.ad`: normal records
    // carry null, while sponsored records carry the complete ad object.
    if (hasOwn(object, "ad") && isMeaningful(object.ad)) return "ad_object";
    if (object.is_ad === true) return "is_ad";
    if (object.is_sponsored === true) return "is_sponsored";
    if (object.show_ad_label === true) return "show_ad_label";

    if (hasOwn(object, "sponsored_data") && isMeaningful(object.sponsored_data)) {
      return "sponsored_data";
    }

    if (hasOwn(object, "ad_metadata") && isMeaningful(object.ad_metadata)) {
      return "ad_metadata";
    }

    var typename = lower(object.__typename);
    if (typename === "graphaditem" || typename === "xdtaditem" ||
        typename === "graphadstoryitem" || typename === "xdtadstoryitem") {
      return "ad_typename";
    }

    if (isObject(object.gating_info)) {
      var gatingType = lower(object.gating_info.gating_type);
      if (gatingType === "ad" || gatingType === "sponsored") return "gating_info";

      var gatingTitle = object.gating_info.title;
      if (isObject(gatingTitle)) gatingTitle = gatingTitle.text;
      gatingTitle = lower(gatingTitle);
      if (gatingTitle.indexOf("sponsor") !== -1 ||
          gatingTitle.indexOf("promoted") !== -1) {
        return "gating_info";
      }
    }

    if (isObject(object.log_extras) && object.log_extras.is_ad === true) {
      return "log_extras.is_ad";
    }

    if (isObject(object.overlay_info)) {
      var overlayType = lower(object.overlay_info.type);
      if (overlayType === "ad" || overlayType === "sponsored" ||
          overlayType === "promoted") {
        return "overlay_info";
      }
    }

    return "";
  }

  function directAdReason(value) {
    if (!isObject(value) || Array.isArray(value)) return "";
    var reason = markedAdReason(value);
    if (reason) return reason;

    // Instagram commonly wraps a feed item in one of these fields. Only
    // inspect the immediate wrapper so a normal post mentioning an ad in a
    // deeply nested object is not removed accidentally.
    var wrapperKeys = ["node", "media", "item", "story", "clip"];
    for (var i = 0; i < wrapperKeys.length; i += 1) {
      var child = value[wrapperKeys[i]];
      reason = markedAdReason(child);
      if (reason) return reason;
    }

    return "";
  }

  function isAdRedirect(value) {
    if (typeof value !== "string") return false;
    var text = value.toLowerCase();
    return text.indexOf("facebook.com/ads/ig_redirect/") !== -1 ||
      text.indexOf("instagram.com/ads/ig_redirect/") !== -1;
  }

  function deepAdReason(value, depth, budget) {
    if (depth > 16 || budget.count > 25000) return "";

    budget.count += 1;
    if (isAdRedirect(value)) return "ad_redirect_url";
    if (!isObject(value)) return "";

    if (!Array.isArray(value)) {
      var direct = markedAdReason(value);
      if (direct) return direct;
    }

    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i += 1) {
      var reason = deepAdReason(value[keys[i]], depth + 1, budget);
      if (reason) return reason;
    }
    return "";
  }

  function recordDetection(reason, path) {
    detected += 1;
    reasons[reason] = (reasons[reason] || 0) + 1;
    if (detectedPaths.length < 8) detectedPaths.push(path);
  }

  function filterTree(value, depth, path, arrayKey) {
    if (!isObject(value) || depth > MAX_DEPTH || visited > MAX_VISITED_NODES) {
      return;
    }

    visited += 1;

    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) {
        var itemPath = path + "[" + i + "]";
        var reason = directAdReason(value[i]);
        if (!reason && ENTRY_ARRAY_KEYS[arrayKey]) {
          reason = deepAdReason(value[i], 0, { count: 0 });
        }

        if (reason) {
          // Detection is intentionally non-mutating. Removing a Relay edge can
          // also remove cursor/sentinel state required for later pagination.
          recordDetection(reason, itemPath);
        } else {
          filterTree(value[i], depth + 1, itemPath, "");
        }
      }
      return;
    }

    var keys = Object.keys(value);
    for (var j = 0; j < keys.length; j += 1) {
      var key = keys[j];
      filterTree(value[key], depth + 1, path + "." + key, key);
    }
  }

  function summarizeReasons() {
    var keys = Object.keys(reasons).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i += 1) {
      parts.push(keys[i] + ":" + reasons[keys[i]]);
    }
    return parts.join(",");
  }

  function readStats() {
    try {
      var stored = $persistentStore.read(STATS_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (_) {
      return {};
    }
  }

  function writeStats(result, errorMessage) {
    try {
      var stats = readStats();
      stats.runs = (stats.runs || 0) + 1;
      stats.detectedResponses = (stats.detectedResponses || 0) + (detected > 0 ? 1 : 0);
      stats.detectedItems = (stats.detectedItems || 0) + detected;
      stats.lastDetected = detected;
      stats.lastResult = result;
      stats.lastError = errorMessage || "";
      stats.lastURL = $request && $request.url ? $request.url : "";
      stats.lastRun = new Date().toISOString();
      $persistentStore.write(JSON.stringify(stats), STATS_KEY);
    } catch (_) {
      // Statistics must never interfere with the response.
    }
  }

  function taggedHeaders(tag) {
    var headers = Object.assign({}, ($response && $response.headers) || {});
    headers["X-Surge-IG-Ad-Filter"] = tag;
    return headers;
  }

  function rewrittenHeaders(tag) {
    var headers = taggedHeaders(tag);
    delete headers["Content-Length"];
    delete headers["content-length"];
    return headers;
  }

  var url = ($request && $request.url) || "";
  var body = $response && $response.body;

  if (typeof body !== "string" || body.length === 0) {
    writeStats("skipped-empty-body", "");
    console.log("[IG Ad Filter] skipped empty body: " + url);
    $done({ headers: taggedHeaders("ran; skipped=empty-body; detected=0") });
    return;
  }

  var responseHeaders = ($response && $response.headers) || {};
  var contentType = responseHeaders["Content-Type"] ||
    responseHeaders["content-type"] || "";
  var looksLikeHtml = /text\/html/i.test(contentType) ||
    /^\s*<!doctype\s+html/i.test(body) || /^\s*<html/i.test(body);

  if (looksLikeHtml) {
    var injectedBody = injectHtml(body);
    var htmlTag = injectedBody ? "ran; mode=html-css; injected=1" :
      "ran; mode=html-css; injected=0";
    writeStats(injectedBody ? "html-injected" : "html-already-injected", "");
    console.log("[IG Ad Filter] " + htmlTag + "; url=" + url);
    if (injectedBody) {
      $done({ headers: rewrittenHeaders(htmlTag), body: injectedBody });
    } else {
      $done({ headers: taggedHeaders(htmlTag) });
    }
    return;
  }

  try {
    var root = JSON.parse(body);
    filterTree(root, 0, "$", "");

    var truncated = visited > MAX_VISITED_NODES;
    var reasonSummary = summarizeReasons();
    var tag = "ran; mode=observe-only; detected=" + detected +
      (reasonSummary ? "; reasons=" + reasonSummary : "") +
      (truncated ? "; scan=limited" : "");
    writeStats(truncated ? "scan-limited" : "ok", "");
    console.log("[IG Ad Filter] " + tag +
      (detectedPaths.length ? "; paths=" + detectedPaths.join(",") : "") +
      "; url=" + url);
    // Return headers only: omitting `body` guarantees Surge forwards the
    // original JSON byte-for-byte, including pagination metadata.
    $done({ headers: taggedHeaders(tag) });
  } catch (error) {
    var message = error && error.message ? error.message : String(error);
    writeStats("skipped-invalid-json", message);
    console.log("[IG Ad Filter] skipped invalid JSON; error=" + message + "; url=" + url);
    $done({ headers: taggedHeaders("ran; skipped=invalid-json; detected=0") });
  }
})();
