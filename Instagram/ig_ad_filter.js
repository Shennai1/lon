/*
 * Instagram Web Ad Filter for Surge
 *
 * Filters only high-confidence ad objects from selected Instagram JSON
 * responses. Every matched response gets a diagnostic response header:
 *
 *   X-Surge-IG-Ad-Filter: ran; removed=N
 *
 * Surge's debug log also receives a line beginning with [IG Ad Filter].
 */

(function () {
  "use strict";

  var STATS_KEY = "ig_ad_filter_stats_v1";
  var MAX_DEPTH = 20;
  var MAX_VISITED_NODES = 150000;
  var removed = 0;
  var visited = 0;
  var reasons = {};
  var removedPaths = [];

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

  function recordRemoval(reason, path) {
    removed += 1;
    reasons[reason] = (reasons[reason] || 0) + 1;
    if (removedPaths.length < 8) removedPaths.push(path);
  }

  function filterTree(value, depth, path, arrayKey) {
    if (!isObject(value) || depth > MAX_DEPTH || visited > MAX_VISITED_NODES) {
      return;
    }

    visited += 1;

    if (Array.isArray(value)) {
      for (var i = value.length - 1; i >= 0; i -= 1) {
        var itemPath = path + "[" + i + "]";
        var reason = directAdReason(value[i]);
        if (!reason && ENTRY_ARRAY_KEYS[arrayKey]) {
          reason = deepAdReason(value[i], 0, { count: 0 });
        }

        if (reason) {
          value.splice(i, 1);
          recordRemoval(reason, itemPath);
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
      stats.modifiedResponses = (stats.modifiedResponses || 0) + (removed > 0 ? 1 : 0);
      stats.removedItems = (stats.removedItems || 0) + removed;
      stats.lastRemoved = removed;
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

  var url = ($request && $request.url) || "";
  var body = $response && $response.body;

  if (typeof body !== "string" || body.length === 0) {
    writeStats("skipped-empty-body", "");
    console.log("[IG Ad Filter] skipped empty body: " + url);
    $done({ headers: taggedHeaders("ran; skipped=empty-body; removed=0") });
    return;
  }

  try {
    var root = JSON.parse(body);
    filterTree(root, 0, "$", "");

    var truncated = visited > MAX_VISITED_NODES;
    var reasonSummary = summarizeReasons();
    var tag = "ran; removed=" + removed +
      (reasonSummary ? "; reasons=" + reasonSummary : "") +
      (truncated ? "; scan=limited" : "");
    writeStats(truncated ? "scan-limited" : "ok", "");
    console.log("[IG Ad Filter] " + tag +
      (removedPaths.length ? "; paths=" + removedPaths.join(",") : "") +
      "; url=" + url);

    if (removed > 0) {
      $done({
        headers: taggedHeaders(tag),
        body: JSON.stringify(root)
      });
    } else {
      $done({ headers: taggedHeaders(tag) });
    }
  } catch (error) {
    var message = error && error.message ? error.message : String(error);
    writeStats("skipped-invalid-json", message);
    console.log("[IG Ad Filter] skipped invalid JSON; error=" + message + "; url=" + url);
    $done({ headers: taggedHeaders("ran; skipped=invalid-json; removed=0") });
  }
})();
