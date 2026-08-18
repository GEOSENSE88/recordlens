/**
 * 저장한 HTML 보고서 안에서 도는 스크립트.
 *
 * 예전에는 모든 기록의 표 행과 상세 창을 미리 HTML로 만들어 파일에 넣었다.
 * 본문이 기록마다 네 번씩 복사되고 낱말마다 태그가 붙어, 7,500건 기준 70MB를 넘고
 * 여는 데만 30초가 걸렸다. 이제는 본문을 데이터로 한 번만 담고 화면은 여기서 그린다.
 *
 * 화면(app/page.tsx)의 강조·비교 로직을 그대로 옮겨 놓은 것이므로,
 * 한쪽을 고치면 다른 쪽도 같이 손봐야 한다.
 */
export const REPORT_SCRIPT = String.raw`
(function () {
  var dataNode = document.getElementById("record-data");
  if (!dataNode) return;
  var payload = JSON.parse(dataNode.textContent);
  var records = payload.records;
  var rules = payload.rules;
  var threshold = payload.threshold;
  var PAGE_SIZE = payload.pageSize;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .split("&").join("&amp;")
      .split("<").join("&lt;")
      .split(">").join("&gt;")
      .split('"').join("&quot;")
      .split("'").join("&#039;");
  }

  function cleanVisible(value) {
    return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeText(value) {
    return cleanVisible(value)
      .toLocaleLowerCase("ko-KR")
      .replace(/[.,!?()\[\]/\-_&@#$%^]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatPercent(value) {
    return Math.round(value * 100) + "%";
  }

  function riskStatus(record) {
    if (record.eg > 1 || record.sim >= 0.9995) return "exact";
    if (record.sim >= threshold) return "high";
    var meaningful = record.i.some(function (issue) { return rules[issue[0]].t !== "symbol"; });
    if (meaningful || record.sim >= Math.max(0.45, threshold - 0.2)) return "review";
    return "normal";
  }

  var RISK_LABELS = { exact: "완전 일치", high: "높은 유사도", review: "확인 필요", normal: "이상 없음" };

  /* ---- 기재요령 지적 위치 강조 ---- */

  function inspectionSegments(text, issues) {
    var candidates = issues
      .map(function (issue) {
        return { rule: rules[issue[0]], index: issue[1], match: issue[2] };
      })
      .filter(function (issue) {
        return issue.index >= 0 && issue.index < text.length && issue.match.length > 0 &&
          issue.index + issue.match.length <= text.length;
      })
      .sort(function (a, b) {
        return a.index - b.index ||
          (b.rule.s === "danger" ? 1 : 0) - (a.rule.s === "danger" ? 1 : 0) ||
          b.match.length - a.match.length;
      });

    var segments = [];
    var cursor = 0;
    candidates.forEach(function (issue) {
      var start = issue.index;
      var end = start + issue.match.length;
      if (start < cursor) return;
      if (start > cursor) segments.push({ text: text.slice(cursor, start) });
      segments.push({ text: text.slice(start, end), issue: issue });
      cursor = end;
    });
    if (cursor < text.length) segments.push({ text: text.slice(cursor) });
    return segments;
  }

  function inspectionHtml(text, issues) {
    return inspectionSegments(text, issues).map(function (segment) {
      if (!segment.issue) return escapeHtml(segment.text);
      var rule = segment.issue.rule;
      return '<mark class="inspection-text-highlight ' + rule.t + '" title="' +
        escapeHtml(rule.l + ": " + rule.g) + '">' + escapeHtml(segment.text) + "</mark>";
    }).join("");
  }

  /* ---- 문장 단위 비교 ---- */

  function splitSentences(value) {
    var parts = value.match(/[^.!?。！？]+[.!?。！？]?\s*/g);
    if (!parts) return [value];
    var kept = parts.filter(function (part) { return part.trim(); });
    return kept.length ? kept : [value];
  }

  function sentenceSimilarity(left, right) {
    var l = {}, r = {}, lc = 0, rc = 0;
    normalizeText(left).split(" ").forEach(function (t) { if (t.length > 1 && !l[t]) { l[t] = 1; lc++; } });
    normalizeText(right).split(" ").forEach(function (t) { if (t.length > 1 && !r[t]) { r[t] = 1; rc++; } });
    var intersection = 0;
    Object.keys(l).forEach(function (t) { if (r[t]) intersection++; });
    var union = lc + rc - intersection;
    return { score: union > 0 ? intersection / union : 0, intersection: intersection };
  }

  function highlightSentences(text, comparisonText) {
    var comparison = splitSentences(comparisonText);
    return splitSentences(text).map(function (sentence) {
      var normalized = normalizeText(sentence);
      var bestScore = 0, bestIntersection = 0, bestIndex = -1, exact = false;
      for (var i = 0; i < comparison.length; i++) {
        if (normalized.length >= 8 && normalized === normalizeText(comparison[i])) {
          exact = true; bestScore = 1; bestIndex = i; break;
        }
        var result = sentenceSimilarity(sentence, comparison[i]);
        if (result.score > bestScore) {
          bestScore = result.score; bestIntersection = result.intersection; bestIndex = i;
        }
      }
      var level = exact ? "exact" : (bestScore >= 0.5 && bestIntersection >= 3 ? "similar" : "none");
      return {
        text: sentence,
        level: level,
        score: bestScore,
        matchedIndex: bestIndex,
        matchedText: bestIndex >= 0 ? comparison[bestIndex] : "",
      };
    });
  }

  function diffSegments(text, comparisonText) {
    function tokenize(value) {
      return value.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}\s]+|\s+/gu) || [value];
    }
    function normalizeToken(value) {
      return /[\p{L}\p{N}]/u.test(value) ? value.normalize("NFKC").toLocaleLowerCase("ko-KR") : "";
    }
    var tokens = tokenize(text);
    var otherTokens = tokenize(comparisonText);
    var words = [], others = [];
    tokens.forEach(function (t, i) { var n = normalizeToken(t); if (n) words.push({ i: i, n: n }); });
    otherTokens.forEach(function (t, i) { var n = normalizeToken(t); if (n) others.push({ i: i, n: n }); });

    var lengths = [];
    for (var a = 0; a <= words.length; a++) lengths.push(new Array(others.length + 1).fill(0));
    for (var x = 1; x <= words.length; x++) {
      for (var y = 1; y <= others.length; y++) {
        lengths[x][y] = words[x - 1].n === others[y - 1].n
          ? lengths[x - 1][y - 1] + 1
          : Math.max(lengths[x - 1][y], lengths[x][y - 1]);
      }
    }
    var unchanged = {};
    var p = words.length, q = others.length;
    while (p > 0 && q > 0) {
      if (words[p - 1].n === others[q - 1].n) { unchanged[words[p - 1].i] = 1; p--; q--; }
      else if (lengths[p - 1][q] >= lengths[p][q - 1]) p--;
      else q--;
    }
    var segments = [];
    tokens.forEach(function (token, i) {
      var changed = Boolean(normalizeToken(token)) && !unchanged[i];
      var previous = segments[segments.length - 1];
      if (previous && previous.changed === changed) previous.text += token;
      else segments.push({ text: token, changed: changed });
    });
    return segments;
  }

  /**
   * 문장에 data-pair 를 달아 두면 마우스를 올렸을 때 양쪽의 같은 문장이 함께 표시된다.
   * A쪽은 짝이 되는 B 문장 번호를, B쪽은 자기 번호를 쓴다.
   */
  function comparisonHtml(text, comparisonText, useMatchedIndex) {
    return highlightSentences(text, comparisonText).map(function (sentence, index) {
      var body = escapeHtml(sentence.text);
      if (sentence.level === "none") return "<span>" + body + "</span>";

      var pair = useMatchedIndex ? sentence.matchedIndex : index;
      var attrs = ' data-pair="p' + pair + '" title="' +
        (sentence.level === "exact" ? "완전 일치 " : "높은 유사도 ") + formatPercent(sentence.score) + '"';

      if (sentence.level === "similar") {
        var inner = diffSegments(sentence.text, sentence.matchedText).map(function (segment) {
          if (segment.changed) return '<span class="diff-fragment">' + escapeHtml(segment.text) + "</span>";
          if (/[\p{L}\p{N}]/u.test(segment.text)) return '<mark class="common-fragment">' + escapeHtml(segment.text) + "</mark>";
          return escapeHtml(segment.text);
        }).join("");
        return '<span class="sentence-highlight similar"' + attrs + ">" + inner + "</span>";
      }
      return '<mark class="sentence-highlight exact"' + attrs + ">" + body + "</mark>";
    }).join("");
  }

  function sharedKeywords(record) {
    if (record.m < 0) return [];
    var other = {};
    normalizeText(records[record.m].t).split(" ").forEach(function (t) { other[t] = 1; });
    var seen = {}, out = [];
    normalizeText(record.t).split(" ").forEach(function (t) {
      if (t.length > 1 && other[t] && !seen[t]) { seen[t] = 1; out.push(t); }
    });
    return out;
  }

  /** 비교 기록과 100% 같은 문장의 수. 유사도 요약에 함께 보여 준다. */
  function exactSentenceCount(record) {
    if (record.m < 0) return 0;
    return highlightSentences(record.t, records[record.m].t).filter(function (sentence) {
      return sentence.level === "exact";
    }).length;
  }

  /* ---- 표 ---- */

  var body = document.getElementById("report-body");
  var searchInput = document.getElementById("report-search");
  var classSelect = document.getElementById("report-class");
  var subjectSelect = document.getElementById("report-subject");
  var riskSelect = document.getElementById("report-risk");
  var issueSelect = document.getElementById("report-issue");
  var sortSelect = document.getElementById("report-sort");
  var rangeLabel = document.getElementById("report-range");
  var pageLabel = document.getElementById("report-page");
  var visibleCount = document.getElementById("visible-count");
  var emptyNote = document.getElementById("report-empty");
  var prevButton = document.getElementById("report-prev");
  var nextButton = document.getElementById("report-next");
  var hideCheckedInput = document.getElementById("report-hide-checked");
  var progressLabel = document.getElementById("report-progress");
  var page = 1;
  var matched = records.slice();

  // 확인 표시: 저장 시점의 값에서 시작해, 저장본 안에서 이어서 확인할 수 있다.
  // (같은 브라우저라면 localStorage 로 다음에 열 때도 유지된다. file:// 등
  // 저장소를 못 쓰는 환경에서는 이번 열람 동안만 유지된다.)
  var CHECK_STORE = "recordlens-checked-v1";
  var checked = {};
  records.forEach(function (record) { if (record.chk) checked[record.k] = 1; });
  try {
    JSON.parse(localStorage.getItem(CHECK_STORE) || "[]").forEach(function (key) {
      checked[key] = 1;
    });
  } catch (ignored) {}
  function persistChecked() {
    try {
      localStorage.setItem(CHECK_STORE, JSON.stringify(Object.keys(checked)));
    } catch (ignored) {}
  }

  records.forEach(function (record, index) {
    record.idx = index;
    record.types = record.i.map(function (issue) { return rules[issue[0]].t; });
    record.hay = normalizeText(record.n + " " + record.c + " " + record.s + " " + record.t + " " + record.mn);
  });

  /* ---- 위험도 분류와 상단 요약 (기준을 바꾸면 다시 계산한다) ---- */

  function computeStatuses() {
    records.forEach(function (record) { record.status = riskStatus(record); });
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  var ISSUE_TYPES = ["typo", "symbol", "prohibited", "institution", "business"];
  var ISSUE_LABELS = {
    typo: "오탈자", symbol: "특수기호", prohibited: "기재금지어",
    institution: "기관명", business: "상호명",
  };

  function renderSummary() {
    var counts = { exact: 0, high: 0, review: 0, normal: 0 };
    records.forEach(function (record) { counts[record.status] += 1; });
    var total = Math.max(1, records.length);
    var fmt = function (n) { return n.toLocaleString("ko-KR"); };

    ["exact", "high", "review", "normal"].forEach(function (risk) {
      setText("r-legend-" + risk, fmt(counts[risk]));
      var fill = document.getElementById("r-fill-" + risk);
      if (fill) fill.style.width = (counts[risk] / total) * 100 + "%";
    });
    setText("r-sum-exact", fmt(counts.exact));
    setText("r-sum-high", fmt(counts.high));
    setText("r-sum-normal", fmt(counts.normal));
    setText("r-sum-high-note", Math.round(threshold * 100) + "% 이상 유사한 문장");
    setText("r-threshold-label", Math.round(threshold * 100) + "%");
    setText("r-flagged-chip", fmt(counts.exact + counts.high + counts.review) + "건 확인");

    // 과목별 현황: 완전 일치·높은 유사도가 많은 순으로 다섯 개
    var subjectList = document.getElementById("r-subject-list");
    if (subjectList) {
      var bySubject = {};
      records.forEach(function (record) {
        var entry = bySubject[record.s] || (bySubject[record.s] = { subject: record.s, total: 0, flagged: 0 });
        entry.total += 1;
        if (record.status === "exact" || record.status === "high") entry.flagged += 1;
      });
      var top = Object.keys(bySubject).map(function (key) { return bySubject[key]; })
        .sort(function (a, b) { return b.flagged - a.flagged || b.total - a.total; })
        .slice(0, 5);
      subjectList.innerHTML = top.map(function (entry) {
        return '<button type="button" class="subject-row" data-subject="' + escapeHtml(entry.subject) + '">' +
          "<span>" + escapeHtml(entry.subject) + "</span>" +
          '<i><b style="width:' + Math.max(4, (entry.flagged / Math.max(1, entry.total)) * 100) + '%"></b></i>' +
          "<strong>" + fmt(entry.flagged) + "건</strong></button>";
      }).join("") || '<p class="muted">과목 정보가 없습니다.</p>';
    }

    // 기재요령 항목별 건수 (기준과 무관하지만 함께 그린다)
    var auditGrid = document.getElementById("r-audit-grid");
    if (auditGrid && !auditGrid.childElementCount) {
      var issueCounts = {};
      records.forEach(function (record) {
        var seen = {};
        record.types.forEach(function (type) { if (!seen[type]) { seen[type] = 1; issueCounts[type] = (issueCounts[type] || 0) + 1; } });
      });
      auditGrid.innerHTML = ISSUE_TYPES.map(function (type) {
        return '<button type="button" class="audit-item" data-issue="' + type + '">' +
          "<span>" + ISSUE_LABELS[type] + "</span><strong>" + fmt(issueCounts[type] || 0) +
          "건</strong></button>";
      }).join("");
    }
  }

  /** 범례·기재요령 단추의 눌림 상태를 현재 필터와 맞춘다. */
  function syncActive() {
    var risk = riskSelect ? riskSelect.value : "all";
    document.querySelectorAll(".legend-item").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-risk") === risk);
    });
    var issue = issueSelect ? issueSelect.value : "all";
    document.querySelectorAll(".audit-item").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-issue") === issue);
    });
  }

  function rowHtml(record) {
    var status = record.status;
    // 앱과 같은 칩: 항목 이름만 보이고, 발견 표현과 이유는 마우스를 올리면 나온다.
    var pills = record.i.length
      ? record.i.slice(0, 3).map(function (issue) {
          var rule = rules[issue[0]];
          return '<span class="inspection-chip ' + rule.s + '" title="' +
            escapeHtml(issue[2] + ": " + rule.g) + '">' + escapeHtml(rule.l) + "</span>";
        }).join("") + (record.i.length > 3 ? "<small>+" + (record.i.length - 3) + "</small>" : "")
      : '<span class="muted-inline">없음</span>';
    var detail = record.m >= 0 || record.i.length
      ? '<a class="compare-button" href="#results" data-open="' + record.idx + '">상세 <b>›</b></a>'
      : '<span class="compare-button disabled">상세</span>';
    return '<tr class="' + (checked[record.k] ? "row-checked" : "") + '">' +
      '<td class="check-cell"><input type="checkbox" data-check="' + record.idx + '"' +
      (checked[record.k] ? " checked" : "") + ' aria-label="확인 여부"></td>' +
      '<td><span class="status-badge ' + status + '"><i></i>' + RISK_LABELS[status] + "</span></td>" +
      '<td><strong class="student-name">' + escapeHtml(record.n) + '</strong><span class="muted">' + escapeHtml(record.c) + "</span></td>" +
      '<td><span class="subject-chip">' + escapeHtml(record.s) + "</span></td>" +
      '<td><strong class="similarity-number ' + status + '">' + formatPercent(record.sim) + "</strong>" +
      (record.mn ? '<span class="muted">↔ ' + escapeHtml(record.mn) + "</span>" : "") + "</td>" +
      '<td><p class="record-preview">' + inspectionHtml(record.t, record.i) + "</p></td>" +
      '<td><div class="record-issues">' + pills + "</div></td>" +
      "<td>" + detail + "</td>" +
      "</tr>";
  }

  function compare(a, b) {
    var mode = sortSelect ? sortSelect.value : "risk";
    if (mode === "class") {
      return a.c.localeCompare(b.c, "ko", { numeric: true }) ||
        ((Number(a.no) || 0) - (Number(b.no) || 0)) ||
        a.s.localeCompare(b.s, "ko");
    }
    if (mode === "name") return a.n.localeCompare(b.n, "ko");
    if (mode === "subject") return a.s.localeCompare(b.s, "ko");
    return (b.sim - a.sim) || a.n.localeCompare(b.n, "ko");
  }

  function apply() {
    var term = normalizeText(searchInput ? searchInput.value : "");
    var classValue = classSelect ? classSelect.value : "all";
    var subjectValue = subjectSelect ? subjectSelect.value : "all";
    var risk = riskSelect ? riskSelect.value : "all";
    var issue = issueSelect ? issueSelect.value : "all";
    var hide = Boolean(hideCheckedInput && hideCheckedInput.checked);

    matched = records.filter(function (record) {
      if (classValue !== "all" && record.c !== classValue) return false;
      if (subjectValue !== "all" && record.s !== subjectValue) return false;
      if (risk !== "all" && record.status !== risk) return false;
      if (issue !== "all" && record.types.indexOf(issue) < 0) return false;
      if (hide && checked[record.k]) return false;
      if (!term) return true;
      return record.hay.indexOf(term) >= 0;
    });
    matched.sort(compare);

    var pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
    if (page > pages) page = pages;
    var start = (page - 1) * PAGE_SIZE;
    var shown = matched.slice(start, start + PAGE_SIZE);

    body.innerHTML = shown.map(rowHtml).join("");

    if (visibleCount) visibleCount.textContent = matched.length.toLocaleString("ko-KR");
    if (pageLabel) pageLabel.textContent = page + " / " + pages;
    if (rangeLabel) {
      rangeLabel.textContent = matched.length
        ? "전체 " + matched.length.toLocaleString("ko-KR") + "건 중 " + (start + 1) + "–" + (start + shown.length) + "건"
        : "조건에 맞는 기록 없음";
    }
    if (emptyNote) emptyNote.hidden = matched.length > 0;
    if (prevButton) prevButton.disabled = page <= 1;
    if (nextButton) nextButton.disabled = page >= pages;
    if (progressLabel) {
      var done = records.reduce(function (sum, record) { return sum + (checked[record.k] ? 1 : 0); }, 0);
      progressLabel.textContent = "확인 완료 " + done.toLocaleString("ko-KR") + " / " +
        records.length.toLocaleString("ko-KR") + "건";
    }
    syncActive();
  }

  function reset() { page = 1; apply(); }

  if (searchInput) searchInput.addEventListener("input", reset);
  if (classSelect) classSelect.addEventListener("change", reset);
  if (subjectSelect) subjectSelect.addEventListener("change", reset);
  if (riskSelect) riskSelect.addEventListener("change", reset);
  if (issueSelect) issueSelect.addEventListener("change", reset);
  if (sortSelect) sortSelect.addEventListener("change", reset);
  if (hideCheckedInput) hideCheckedInput.addEventListener("change", reset);

  // 유사도 기준 슬라이더: 위험도를 다시 나누고 요약·표를 함께 갱신한다.
  var thresholdInput = document.getElementById("report-threshold");
  if (thresholdInput) {
    thresholdInput.addEventListener("input", function () {
      threshold = Number(thresholdInput.value);
      computeStatuses();
      renderSummary();
      reset();
    });
  }

  // 위험도 범례: 누르면 그 위험도만, 다시 누르면 전체.
  document.addEventListener("click", function (event) {
    var legend = event.target.closest ? event.target.closest("[data-risk]") : null;
    if (legend && riskSelect) {
      var risk = legend.getAttribute("data-risk");
      riskSelect.value = riskSelect.value === risk ? "all" : risk;
      reset();
      return;
    }
    var audit = event.target.closest ? event.target.closest("[data-issue]") : null;
    if (audit && issueSelect) {
      var issue = audit.getAttribute("data-issue");
      issueSelect.value = issueSelect.value === issue ? "all" : issue;
      reset();
      var results = document.getElementById("results");
      if (results) results.scrollIntoView({ behavior: "smooth" });
      return;
    }
    var subjectButton = event.target.closest ? event.target.closest("[data-subject]") : null;
    if (subjectButton && subjectSelect) {
      subjectSelect.value = subjectButton.getAttribute("data-subject");
      reset();
      var panel = document.getElementById("results");
      if (panel) panel.scrollIntoView({ behavior: "smooth" });
    }
  });

  // 표의 확인 체크박스: 표시를 저장하고 화면을 다시 그린다.
  document.addEventListener("change", function (event) {
    var box = event.target.closest ? event.target.closest("[data-check]") : null;
    if (!box) return;
    var record = records[Number(box.getAttribute("data-check"))];
    if (!record) return;
    if (box.checked) checked[record.k] = 1;
    else delete checked[record.k];
    persistChecked();
    apply();
  });
  if (prevButton) prevButton.addEventListener("click", function () { if (page > 1) { page -= 1; apply(); } });
  if (nextButton) nextButton.addEventListener("click", function () {
    if (page < Math.max(1, Math.ceil(matched.length / PAGE_SIZE))) { page += 1; apply(); }
  });

  /* ---- 상세 창 ---- */

  var host = document.getElementById("dialog-host");

  function dialogHtml(record) {
    var status = record.status;
    var other = record.m >= 0 ? records[record.m] : null;

    var issueItems = record.i.map(function (issue) {
      var rule = rules[issue[0]];
      return '<li class="' + rule.t + '"><div><strong>' + escapeHtml(rule.l) + "</strong><mark>" +
        escapeHtml(issue[2]) + "</mark></div><p>" + escapeHtml(rule.g) + "</p><small>" +
        escapeHtml(rule.r) + "</small></li>";
    }).join("");

    var html = '<section class="compare-dialog is-open" id="comparison-' + record.idx + '" aria-label="기록 종합점검">' +
      '<a class="dialog-backdrop" href="#results" data-close="1" aria-label="상세 창 닫기"></a>' +
      '<article class="dialog-sheet"><header class="dialog-header"><div>' +
      '<span class="status-badge ' + status + '"><i></i>' + RISK_LABELS[status] + "</span>" +
      "<h2>" + escapeHtml(record.n) + " · " + escapeHtml(record.s) + "</h2>" +
      '<small class="dialog-sub">' + escapeHtml(record.c) + "</small></div>" +
      '<a class="dialog-close" href="#results" data-close="1" aria-label="상세 창 닫기">×</a></header>';

    if (issueItems) {
      html += '<section class="inspection-source"><div><strong>지적 위치가 표시된 원문</strong>' +
        "<small>색칠된 표현에 마우스를 올리면 점검 이유를 확인할 수 있습니다.</small></div><p>" +
        inspectionHtml(record.t, record.i) + "</p></section>" +
        '<section class="rule-findings"><h3>2026 기재요령·문장 점검</h3><ul>' + issueItems +
        "</ul><p>자동 탐지는 보조 기능입니다. 기관명·상호명과 맞춤법은 문맥 및 허용 예외를 직접 확인해 주세요.</p></section>";
    }

    if (other) {
      var keywords = sharedKeywords(record);
      html += '<div class="similarity-callout"><div><span>자카드 유사도</span><strong>' +
        formatPercent(record.sim) + "</strong></div><p>완전 일치 문장 " + exactSentenceCount(record) +
        "개 · 전체 고유 단어 중 " + keywords.length + "개가 공통으로 확인되었습니다.</p></div>" +
        '<div class="highlight-guide"><span><i class="exact"></i>완전 일치 문장·공통 부분</span>' +
        '<span><i class="similar"></i>문장 내 다른 부분</span>' +
        "<small>문장에 마우스를 올리면 양쪽의 같은 문장이 함께 표시됩니다.</small></div>" +
        '<div class="comparison-grid" data-pair-scope="1"><section><h3>A · ' + escapeHtml(record.n) + "</h3>" +
        "<small>" + escapeHtml(record.c) + " · " + escapeHtml(record.s) + "</small><p>" +
        comparisonHtml(record.t, other.t, true) + "</p></section>" +
        "<section><h3>B · " + escapeHtml(record.mn || "비교 대상") + "</h3>" +
        "<small>가장 유사한 다른 기록</small><p>" +
        comparisonHtml(other.t, record.t, false) + "</p></section></div>";

      if (keywords.length) {
        html += '<div class="keywords"><span>두 문장에 함께 나온 주요 단어</span>' +
          keywords.slice(0, 18).map(function (k) { return "<i>" + escapeHtml(k) + "</i>"; }).join("") +
          "<small>※ 공통 단어 목록은 최대 18개까지 표시합니다. 유사도 계산은 두 기록의 전체 고유 단어를 사용합니다.</small></div>";
      }
    }

    html += "<footer>원본: " + escapeHtml(record.f) + " · " + record.w + "행</footer></article></section>";
    return html;
  }

  function closeDialog() {
    host.innerHTML = "";
    document.body.style.overflow = "";
  }

  function openDialog(index) {
    var record = records[index];
    if (!record) return;
    host.innerHTML = dialogHtml(record);
    document.body.style.overflow = "hidden";
  }

  document.addEventListener("click", function (event) {
    var opener = event.target.closest ? event.target.closest("[data-open]") : null;
    if (opener) { event.preventDefault(); openDialog(Number(opener.getAttribute("data-open"))); return; }
    var closer = event.target.closest ? event.target.closest("[data-close]") : null;
    if (closer) { event.preventDefault(); closeDialog(); }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeDialog();
  });

  // 문장에 마우스를 올리면 양쪽의 같은 문장을 함께 표시한다.
  document.addEventListener("mouseover", function (event) {
    var target = event.target.closest ? event.target.closest("[data-pair]") : null;
    if (!target) return;
    var scope = target.closest("[data-pair-scope]");
    if (!scope) return;
    var pair = target.getAttribute("data-pair");
    scope.querySelectorAll('[data-pair="' + pair + '"]').forEach(function (node) {
      node.classList.add("pair-active");
    });
  });
  document.addEventListener("mouseout", function (event) {
    var target = event.target.closest ? event.target.closest("[data-pair]") : null;
    if (!target) return;
    var scope = target.closest("[data-pair-scope]");
    if (!scope) return;
    scope.querySelectorAll(".pair-active").forEach(function (node) {
      node.classList.remove("pair-active");
    });
  });

  computeStatuses();
  renderSummary();
  apply();
})();
`;
