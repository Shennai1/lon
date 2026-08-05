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

  function isMarkedAd(object) {
    if (!isObject(object) || Array.isArray(object)) {
      return false;
    }

    if (hasOwn(object, "ad_id") && isMeaningful(object.ad_id)) return true;
    if (hasOwn(object, "ad_action_url") && isMeaningful(object.ad_action_url)) return true;
    if (hasOwn(object, "ad_title") && isMeaningful(object.ad_title)) return true;
    if (hasOwn(object, "ad_link_type") && isMeaningful(object.ad_link_type)) return true;
    if (object.is_ad === true || object.show_ad_label === true) return true;

    if (hasOwn(object, "sponsored_data") && isMeaningful(object.sponsored_data)) {
      return true;
    }

    var typename = lower(object.__typename);
    if (typename === "graphaditem" || typename === "xdtaditem" ||
        typename === "graphadstoryitem" || typename === "xdtadstoryitem") {
      return true;
    }

    if (isObject(object.gating_info)) {
      var gatingType = lower(object.gating_info.gating_type);
      if (gatingType === "ad" || gatingType === "sponsored") return true;

      var gatingTitle = object.gating_info.title;
      if (isObject(gatingTitle)) gatingTitle = gatingTitle.text;
      gatingTitle = lower(gatingTitle);
      if (gatingTitle.indexOf("sponsor") !== -1 ||
          gatingTitle.indexOf("promoted") !== -1) {
        return true;
      }
    }

    if (isObject(object.log_extras) && object.log_extras.is_ad === true) {
      return true;
    }

    if (isObject(object.overlay_info)) {
      var overlayType = lower(object.overlay_info.type);
      if (overlayType === "ad" || overlayType === "sponsored" ||
          overlayType === "promoted") {
        return true;
      }
    }

    return false;
  }

  function isAdContainer(value) {
    if (!isObject(value) || Array.isArray(value)) return false;
    if (isMarkedAd(value)) return true;

    // Instagram commonly wraps a feed item in one of these fields. Only
    // inspect the immediate wrapper so a normal post mentioning an ad in a
    // deeply nested object is not removed accidentally.
    var wrapperKeys = ["node", "media", "item", "story", "clip"];
    for (var i = 0; i < wrapperKeys.length; i += 1) {
      var child = value[wrapperKeys[i]];
      if (isMarkedAd(child)) return true;
    }

    return false;
  }

  function filterTree(value, depth) {
    if (!isObject(value) || depth > MAX_DEPTH || visited > MAX_VISITED_NODES) {
      return;
    }

    visited += 1;

    if (Array.isArray(value)) {
      for (var i = value.length - 1; i >= 0; i -= 1) {
        if (isAdContainer(value[i])) {
          value.splice(i, 1);
          removed += 1;
        } else {
          filterTree(value[i], depth + 1);
        }
      }
      return;
    }

    var keys = Object.keys(value);
    for (var j = 0; j < keys.length; j += 1) {
      filterTree(value[keys[j]], depth + 1);
    }
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
    filterTree(root, 0);

    var truncated = visited > MAX_VISITED_NODES;
    var tag = "ran; removed=" + removed + (truncated ? "; scan=limited" : "");
    writeStats(truncated ? "scan-limited" : "ok", "");
    console.log("[IG Ad Filter] " + tag + "; url=" + url);

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
