"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/shared/command-highlighting.js
  var require_command_highlighting = __commonJS({
    "src/shared/command-highlighting.js"(exports, module) {
      (function initSessionCommandHighlighting(root, factory) {
        const api = factory();
        if (typeof module === "object" && module.exports) module.exports = api;
        root.sessionCommandHighlighting = api;
      })(typeof globalThis !== "undefined" ? globalThis : exports, () => {
        "use strict";
        const SHELL_EXTERNAL_COMMAND_WORDS = Object.freeze([
          "adb",
          "bun",
          "cargo",
          "docker",
          "gh",
          "git",
          "go",
          "kubectl",
          "node",
          "npm",
          "npx",
          "pip",
          "pip3",
          "pnpm",
          "pytest",
          "python",
          "python3",
          "rg",
          "uv",
          "yarn"
        ]);
        return {
          SHELL_EXTERNAL_COMMAND_WORDS
        };
      });
    }
  });

  // src/shared/i18n.js
  var require_i18n = __commonJS({
    "src/shared/i18n.js"(exports, module) {
      (function initI18n(root, factory) {
        const api = factory();
        if (typeof module === "object" && module.exports) module.exports = api;
        root.sessionI18n = api;
      })(typeof globalThis !== "undefined" ? globalThis : exports, function createI18nApi() {
        "use strict";
        const DEFAULT_LOCALE = "en";
        const SUPPORTED_LOCALES = ["en", "zh-CN"];
        const catalogs = {
          en: {
            ui: {
              localeLabel: "Language",
              selectProject: "Select project",
              select: "Select",
              change: "Change",
              return: "Return",
              returning: "Returning",
              stateLoading: "Reading local sessions...",
              chooseTargetProjectContinue: "Choose a target project to continue.",
              loadingProjectList: "Loading project list...",
              searchPlaceholder: "Search messages, commands, files, output",
              searchOptions: "Search options",
              searchFilters: "Search filters",
              kind: "Kind",
              status: "Status",
              layer: "Layer",
              file: "File",
              anyKind: "Any kind",
              anyStatus: "Any status",
              currentLayer: "Current layer",
              anyFile: "Any file",
              active: "Active",
              mainTimeline: "Main timeline",
              protocolLayer: "Protocol layer",
              rawRecords: "Raw records",
              projectUnavailable: "No project is available to return to",
              projectIndexUnavailable: "Project index completed but state is not available",
              resetFolds: "Reset folds",
              sessions: "Sessions",
              events: "Events",
              detail: "Detail",
              chooseProject: "Choose a Codex session working directory to analyze.",
              cancelIndexing: "Cancel indexing",
              sort: "Sort",
              updatedDesc: "Recently updated",
              startedAsc: "Start time",
              eventsDesc: "Most events",
              failuresDesc: "Most failed commands",
              chooseSession: "Select a session",
              leftListFiltered: "The left list is filtered by the current repository.",
              eventDetail: "Event detail",
              clickTimelineEvent: "Click a timeline event to inspect the original JSONL records.",
              loadMore: "Load more",
              loadMoreCount: "Load more ({loaded}/{total})",
              loadedCount: "Loaded {loaded}",
              dirtyProfileTitle: "Unsaved folding strategy changes",
              dirtyProfileMessage: "Before switching strategies, save the current changes, discard them, or stay on the current strategy.",
              currentStrategy: "Current strategy",
              saveAs: "Save as",
              saveAndSwitch: "Save and switch",
              discardAndSwitch: "Discard and switch",
              cancel: "Cancel",
              customProfileName: "{name} (custom {count})",
              openingProject: "Opening {name}",
              indexingProject: "Indexing matching Codex sessions before showing the project timeline.",
              switchProject: "Switch project: {root}",
              switchTargetProject: "Switch target project: {root}",
              returnToProject: "Return to project: {root}",
              returnToCurrentProject: "Return to current project: {root}",
              returningToProject: "Returning to project: {root}",
              returningToCurrentProject: "Returning to current project: {root}",
              indexingCancelled: "Indexing cancelled",
              indexingFailed: "Indexing failed",
              indexingCancelledSentence: "Indexing cancelled.",
              readingMatchingSessions: "Reading matching sessions for {repoRoot}. This can take a few seconds for large transcript history.",
              preparingIndex: "Preparing index for {name}",
              scanningFiles: "Scanning {done}/{total} transcript files",
              parsingFiles: "Parsing {done}/{total} candidate files",
              candidates: "{count} candidates",
              skipped: "{count} skipped",
              sessionCount: "{count} sessions",
              logicalEventCount: "{count} logical events",
              rawRecordCount: "{count} raw records",
              messageCountShort: "{count} msgs",
              toolCountShort: "{count} tools",
              failedCommandCountShort: "{count} failed cmds",
              protocolCountShort: "{count} protocol",
              projectActivityLoading: "Loading project activity from {codexHome}...",
              projectActivity: "Project activity",
              discoveringProjects: "Discovering transcript projects...",
              projectCandidates: "{count} project candidates from {codexHome}",
              noProjectCandidates: "No project candidates from {codexHome}",
              noCodexProjects: "No Codex projects were found in the configured sessions directory.",
              lastSelected: "Last selected",
              missingDirectory: "Missing directory",
              indexing: "Indexing...",
              open: "Open",
              activityLoading: "Activity loading...",
              noTranscriptActivity: "No transcript activity",
              selectSessionFirst: "Choose a target project first.",
              noMatchingSession: "No matching session",
              adjustSearchFilters: "Adjust the search or filters.",
              loading: "Loading...",
              noMatches: "No matches",
              matchCount: "{current} / {total} matches",
              sessionsMatchTotal: "Sessions: {count} match ({total} total)",
              sessionsMatch: "Sessions: {count} match",
              eventsMatchLoaded: "Events: {count} match ({loaded} loaded)",
              eventsMatch: "Events: {count} match",
              eventsSelectSession: "Events: select a session",
              searchMatchTitle: "Rendered jump targets; total keeps the full-text count and is raised when more rendered targets are visible",
              activeFindFilters: "Active find and filters",
              clearAll: "Clear all",
              clear: "Clear {label}",
              find: "Find",
              readFromHere: "Read from here",
              readFromHereTitle: "Clear event filters, switch to Main timeline, and keep this position",
              noActiveFilters: "No active find or filters",
              foldingStrategy: "Folding strategy",
              strategy: "Strategy",
              fixedProfileRules: "Folding strategies apply only to Main timeline. This layer uses fixed display rules.",
              protocolFixedRules: "Protocol events are shown as summaries; non-protocol events stay collapsed.",
              rawFixedRules: "Raw event_msg and response_item records stay collapsed; other raw records are shown as summaries.",
              viewMainTimeline: "View Main timeline",
              unsavedPreview: "Unsaved preview",
              disabled: "Disabled",
              default: "Default",
              eventKinds: "Event kinds",
              noExplicitKindRules: "No explicit event-kind rules.",
              defaultKindCount: "{count} event kinds use Default",
              conditions: "Conditions",
              noActiveConditions: "No active conditions.",
              inactiveConditions: "{count} inactive conditions",
              saveProfileChanges: "Save profile changes",
              cancelProfileChanges: "Cancel profile changes",
              save: "Save",
              back: "Back",
              close: "Close",
              inspectEvent: "Inspect event",
              rawRefs: "Raw refs",
              noRawRows: "No raw source rows are available for this event.",
              rawRowsForEvent: "{count} JSONL row{plural} for {eventId}",
              rawRows: "{count} JSONL row{plural}",
              noRawRefs: "No raw refs available",
              inspect: "Inspect event",
              severity: "Severity",
              summary: "Summary",
              metadata: "Metadata",
              source: "Source",
              time: "Time",
              tool: "Tool",
              exitCode: "Exit code",
              duration: "Duration",
              recordType: "Record type",
              channels: "Channels",
              touchedFiles: "Touched files",
              details: "Details",
              loadingStructuredDetail: "Loading structured detail...",
              retryDetail: "Retry detail",
              previousSearchMatch: "Previous search match",
              nextSearchMatch: "Next search match",
              collapseEvent: "Collapse event",
              expandEvent: "Expand event",
              previous: "Prev",
              next: "Next",
              loadingNavigation: "Loading navigation...",
              eventQuickNavigation: "Event quick navigation",
              quickNavigationCategory: "Quick navigation category",
              fixedRuleSubtitle: "{layer} uses fixed display rules",
              remaining: "remaining",
              resets: "Resets",
              files: "files",
              raw: "raw",
              sessionMetadata: "Session metadata",
              reviewKind: "Review",
              subagentKind: "Subagent",
              derivedFrom: "{kind}{nickname} \xB7 from {parent}",
              derivedSession: "{kind}{nickname} session",
              forkFrom: "Fork \xB7 from {parent}",
              metricTurns: "Turns",
              metricMessages: "Messages",
              metricIssues: "Issues",
              metricFiles: "Files",
              metricProtocol: "Protocol",
              metricPlans: "Plans",
              switchToConversationProfile: "Switch to conversation reading folding strategy",
              switchToIssueProfile: "Switch to issue-focused folding strategy",
              switchToChangesProfile: "Switch to change review folding strategy",
              switchToProtocolLayer: "Switch to protocol layer events",
              switchToPlanningProfile: "Switch to planning reading folding strategy",
              metricShortcutMainOnly: "{label} shortcut is available on Main timeline only.",
              metricActionCount: "{action}: {value} {label}",
              profileInfoEmpty: "No folding strategy descriptions.",
              profileInfoMissingDescription: "No description.",
              profileInfoLabel: "View folding strategy descriptions. Current strategy: {name}. {description}"
            },
            displayState: {
              expanded: "Expanded",
              summary: "Summary",
              collapsed: "Collapsed",
              hidden: "Hidden"
            },
            kind: {
              user_message: "User message",
              assistant_message: "Assistant message",
              command: "Command",
              patch: "Patch",
              mcp_call: "MCP call",
              js_repl: "JS REPL",
              other_tool_call: "Other tool call",
              proposed_plan: "Proposed plan",
              plan_update: "Plan update",
              protocol: "Protocol",
              error: "Error",
              warning: "Warning",
              abort: "Turn aborted",
              rollback: "Thread rollback",
              compaction: "Context compaction",
              usage_limit_warning: "Usage limit warning",
              subagent: "Subagent activity",
              review: "Review",
              reasoning: "Reasoning",
              web_search: "Web search",
              event: "Event"
            },
            protocol: {
              agents_instructions: "AGENTS.md instructions",
              developer_collaboration_mode: "Collaboration mode",
              developer_instruction: "Developer instruction",
              developer_permissions: "Developer permissions",
              environment_context: "Environment context",
              session_configured: "Session configured",
              task_complete: "Task complete",
              task_started: "Task started",
              thread_goal_updated: "Thread goal updated",
              turn_complete: "Turn complete",
              turn_started: "Turn started",
              image_wrapper: "Image attachment wrapper",
              meta_block: "Protocol metadata block",
              session_meta: "Session metadata",
              skill_injection: "Skill instructions",
              token_count: "Token count",
              turn_aborted_marker: "Turn aborted marker",
              turn_context: "Turn context",
              user_shell_command: "User shell command"
            },
            status: {
              failed: "Failed",
              success: "Success",
              completed: "Completed"
            },
            section: {
              Arguments: "Arguments",
              Patch: "Patch",
              Output: "Output",
              Request: "Request",
              Response: "Response",
              "User input": "User input",
              "Image preview": "Image preview",
              "Plan update": "Plan update",
              "Search action": "Search action",
              "Search payload": "Search payload",
              "Usage limits": "Usage limits",
              "Token usage": "Token usage",
              "Command arguments": "Command arguments",
              "Raw JSON": "Raw JSON",
              "Review request": "Review request",
              "Review result": "Review result",
              "Overall explanation": "Overall explanation",
              Findings: "Findings",
              "Review output JSON": "Review output JSON",
              "Event fields": "Event fields",
              "Event raw JSON": "Event raw JSON",
              Message: "Message",
              Plan: "Plan",
              Reasoning: "Reasoning",
              Details: "Details",
              Code: "Code",
              Question: "Question",
              Answer: "Answer",
              Selected: "Selected",
              Targets: "Targets",
              Result: "Result"
            },
            foldingCondition: {
              searchHit: ["Search hit", "Events matching the current search query."],
              importantEvent: ["Important event", "User/assistant messages, patches, errors, aborts, rollbacks, compactions, plans, plan updates, update_plan calls, failed events, and abnormal severity."],
              updatePlanCall: ["update_plan call", "Calls to the update_plan tool and protocol plan updates."],
              userInputRequest: ["User input request", "Calls to request_user_input that collect user choices during a conversation."],
              readableReasoning: ["Readable reasoning", "Reasoning entries that contain readable text in the Main timeline."],
              failedStatus: ["Failed status", "Events whose status is failed."],
              errorSeverity: ["Error severity", "Events whose severity is error."],
              abnormalSeverity: ["Abnormal severity", "Events whose severity is not normal."],
              reviewCommand: ["Review command", "Command previews containing common verification or source-control review terms."],
              touchedFiles: ["Touched files", "Events that reference changed or touched files."]
            },
            foldingProfile: {
              narrative: ["Narrative timeline", "Close to what you saw while developing: the goal, how the work moved, and what result came out."],
              conversation: ["Conversation reading", "Read natural-language continuity first: requirements, plan reports, and outcomes, while temporarily skipping tool and code details."],
              changes: ["Change review", "Focus on file changes: what changed, which files were touched, and whether review or validation happened."],
              debug: ["Error focus", "Focus on failures, errors, and interruption points in tool-driven flows."],
              planning: ["Planning review", "Inspect whether the task moved as expected: the plan, current progress, and surprises that changed next steps."],
              search: ["Search focus", "Read with keywords in mind; when search results exist, prioritize matching fragments."],
              compact: ["Full compact", "Scan the entire process without dropping events, with everything compact by default."]
            },
            navigation: {
              search_hits: "Search hits",
              user_messages: "User messages",
              assistant_messages: "Assistant messages",
              update_plan: "Plan updates",
              plans: "Plans / updates",
              failed_commands: "Failed commands",
              commands: "Commands",
              patch_applied: "Patch applied",
              patch_failed: "Patch failed",
              patches: "All patches",
              errors_warnings: "Errors / warnings",
              mcp_calls: "MCP calls",
              web_searches: "Web searches"
            },
            renderer: {
              remaining: "remaining",
              resets: "Resets",
              selected: "Selected",
              question: "Question",
              answer: "Answer",
              unknown: "unknown",
              timedOut: "timed out",
              message: "Message",
              result: "Result",
              targets: "Targets",
              imageAlt: "Image preview",
              imageError: "Image preview could not be loaded.",
              imageUnavailable: "Image preview is unavailable."
            }
          },
          "zh-CN": {
            ui: {
              localeLabel: "\u8BED\u8A00",
              selectProject: "\u9009\u62E9\u9879\u76EE",
              select: "\u9009\u62E9",
              change: "\u5207\u6362",
              return: "\u8FD4\u56DE",
              returning: "\u8FD4\u56DE\u4E2D",
              stateLoading: "\u6B63\u5728\u8BFB\u53D6\u672C\u5730 sessions...",
              chooseTargetProjectContinue: "\u8BF7\u9009\u62E9\u76EE\u6807\u9879\u76EE\u7EE7\u7EED\u3002",
              loadingProjectList: "\u9879\u76EE\u5217\u8868\u52A0\u8F7D\u4E2D...",
              searchPlaceholder: "\u641C\u7D22\u6D88\u606F\u3001\u547D\u4EE4\u3001\u6587\u4EF6\u3001\u8F93\u51FA",
              searchOptions: "\u641C\u7D22\u9009\u9879",
              searchFilters: "\u641C\u7D22\u7B5B\u9009",
              kind: "\u7C7B\u578B",
              status: "\u72B6\u6001",
              layer: "\u5C42\u7EA7",
              file: "\u6587\u4EF6",
              anyKind: "\u4EFB\u610F\u7C7B\u578B",
              anyStatus: "\u4EFB\u610F\u72B6\u6001",
              currentLayer: "\u5F53\u524D\u5C42\u7EA7",
              anyFile: "\u4EFB\u610F\u6587\u4EF6",
              active: "\u5DF2\u542F\u7528",
              mainTimeline: "\u4E3B\u65F6\u95F4\u7EBF",
              protocolLayer: "\u534F\u8BAE\u5C42",
              rawRecords: "\u539F\u59CB\u8BB0\u5F55",
              projectUnavailable: "\u6CA1\u6709\u53EF\u8FD4\u56DE\u7684\u9879\u76EE",
              projectIndexUnavailable: "\u9879\u76EE\u7D22\u5F15\u5DF2\u5B8C\u6210\uFF0C\u4F46\u72B6\u6001\u4E0D\u53EF\u7528",
              resetFolds: "\u91CD\u7F6E\u5C55\u5F00\u72B6\u6001",
              sessions: "Sessions",
              events: "\u4E8B\u4EF6",
              detail: "\u8BE6\u60C5",
              chooseProject: "\u9009\u62E9\u4E00\u4E2A Codex session \u5DE5\u4F5C\u76EE\u5F55\u8FDB\u884C\u5206\u6790\u3002",
              cancelIndexing: "\u53D6\u6D88\u7D22\u5F15",
              sort: "\u6392\u5E8F",
              updatedDesc: "\u6700\u8FD1\u66F4\u65B0",
              startedAsc: "\u5F00\u59CB\u65F6\u95F4",
              eventsDesc: "\u4E8B\u4EF6\u6700\u591A",
              failuresDesc: "\u5931\u8D25\u547D\u4EE4\u6700\u591A",
              chooseSession: "\u9009\u62E9\u4E00\u4E2A session",
              leftListFiltered: "\u5DE6\u4FA7\u5217\u8868\u6309\u5F53\u524D\u4ED3\u5E93\u8FC7\u6EE4\u3002",
              eventDetail: "\u4E8B\u4EF6\u8BE6\u60C5",
              clickTimelineEvent: "\u70B9\u51FB\u65F6\u95F4\u7EBF\u4E8B\u4EF6\u67E5\u770B\u539F\u59CB JSONL \u8BB0\u5F55\u3002",
              loadMore: "\u52A0\u8F7D\u66F4\u591A",
              loadMoreCount: "\u52A0\u8F7D\u66F4\u591A\uFF08{loaded}/{total}\uFF09",
              loadedCount: "\u5DF2\u52A0\u8F7D {loaded}",
              dirtyProfileTitle: "\u6298\u53E0\u7B56\u7565\u6709\u672A\u4FDD\u5B58\u4FEE\u6539",
              dirtyProfileMessage: "\u5207\u6362\u7B56\u7565\u524D\uFF0C\u8BF7\u9009\u62E9\u4FDD\u5B58\u5F53\u524D\u4FEE\u6539\u3001\u653E\u5F03\u4FEE\u6539\uFF0C\u6216\u7559\u5728\u5F53\u524D\u7B56\u7565\u7EE7\u7EED\u7F16\u8F91\u3002",
              currentStrategy: "\u5F53\u524D\u7B56\u7565",
              saveAs: "\u4FDD\u5B58\u4E3A",
              saveAndSwitch: "\u4FDD\u5B58\u5E76\u5207\u6362",
              discardAndSwitch: "\u4E0D\u4FDD\u5B58\u5E76\u5207\u6362",
              cancel: "\u53D6\u6D88",
              customProfileName: "{name}\uFF08\u81EA\u5B9A\u4E49{count}\uFF09",
              openingProject: "\u6B63\u5728\u6253\u5F00 {name}",
              indexingProject: "\u6B63\u5728\u7D22\u5F15\u5339\u914D\u7684 Codex sessions\uFF0C\u7136\u540E\u663E\u793A\u9879\u76EE\u65F6\u95F4\u7EBF\u3002",
              switchProject: "\u5207\u6362\u9879\u76EE\uFF1A{root}",
              switchTargetProject: "\u5207\u6362\u76EE\u6807\u9879\u76EE\uFF1A{root}",
              returnToProject: "\u8FD4\u56DE\u9879\u76EE\uFF1A{root}",
              returnToCurrentProject: "\u8FD4\u56DE\u5F53\u524D\u9879\u76EE\uFF1A{root}",
              returningToProject: "\u6B63\u5728\u8FD4\u56DE\u9879\u76EE\uFF1A{root}",
              returningToCurrentProject: "\u6B63\u5728\u8FD4\u56DE\u5F53\u524D\u9879\u76EE\uFF1A{root}",
              indexingCancelled: "\u7D22\u5F15\u5DF2\u53D6\u6D88",
              indexingFailed: "\u7D22\u5F15\u5931\u8D25",
              indexingCancelledSentence: "\u7D22\u5F15\u5DF2\u53D6\u6D88\u3002",
              readingMatchingSessions: "\u6B63\u5728\u8BFB\u53D6 {repoRoot} \u7684\u5339\u914D sessions\u3002transcript \u5386\u53F2\u8F83\u5927\u65F6\u53EF\u80FD\u9700\u8981\u51E0\u79D2\u3002",
              preparingIndex: "\u6B63\u5728\u4E3A {name} \u51C6\u5907\u7D22\u5F15",
              scanningFiles: "\u6B63\u5728\u626B\u63CF {done}/{total} \u4E2A transcript \u6587\u4EF6",
              parsingFiles: "\u6B63\u5728\u89E3\u6790 {done}/{total} \u4E2A\u5019\u9009\u6587\u4EF6",
              candidates: "{count} \u4E2A\u5019\u9009",
              skipped: "\u8DF3\u8FC7 {count} \u4E2A",
              sessionCount: "{count} \u4E2A sessions",
              logicalEventCount: "{count} \u4E2A\u903B\u8F91\u4E8B\u4EF6",
              rawRecordCount: "{count} \u4E2A\u539F\u59CB\u8BB0\u5F55",
              messageCountShort: "{count} \u6761\u6D88\u606F",
              toolCountShort: "{count} \u4E2A\u5DE5\u5177",
              failedCommandCountShort: "{count} \u4E2A\u5931\u8D25\u547D\u4EE4",
              protocolCountShort: "{count} \u4E2A\u534F\u8BAE\u4E8B\u4EF6",
              projectActivityLoading: "\u6B63\u5728\u4ECE {codexHome} \u52A0\u8F7D\u9879\u76EE\u6D3B\u52A8...",
              projectActivity: "\u9879\u76EE\u6D3B\u52A8",
              discoveringProjects: "\u6B63\u5728\u53D1\u73B0 transcript \u9879\u76EE...",
              projectCandidates: "\u6765\u81EA {codexHome} \u7684 {count} \u4E2A\u9879\u76EE\u5019\u9009",
              noProjectCandidates: "{codexHome} \u4E2D\u6CA1\u6709\u9879\u76EE\u5019\u9009",
              noCodexProjects: "\u914D\u7F6E\u7684 sessions \u76EE\u5F55\u4E2D\u6CA1\u6709\u53D1\u73B0 Codex \u9879\u76EE\u3002",
              lastSelected: "\u4E0A\u6B21\u9009\u62E9",
              missingDirectory: "\u76EE\u5F55\u7F3A\u5931",
              indexing: "\u6B63\u5728\u7D22\u5F15...",
              open: "\u6253\u5F00",
              activityLoading: "\u6D3B\u52A8\u52A0\u8F7D\u4E2D...",
              noTranscriptActivity: "\u6CA1\u6709 transcript \u6D3B\u52A8",
              selectSessionFirst: "\u8BF7\u5148\u9009\u62E9\u76EE\u6807\u9879\u76EE\u3002",
              noMatchingSession: "\u6CA1\u6709\u5339\u914D\u7684 session",
              adjustSearchFilters: "\u8C03\u6574\u641C\u7D22\u6216\u7B5B\u9009\u3002",
              loading: "\u52A0\u8F7D\u4E2D...",
              noMatches: "\u65E0\u5339\u914D",
              matchCount: "{current} / {total} \u4E2A\u547D\u4E2D",
              sessionsMatchTotal: "Sessions\uFF1A{count} \u4E2A\u5339\u914D\uFF08\u5171 {total}\uFF09",
              sessionsMatch: "Sessions\uFF1A{count} \u4E2A\u5339\u914D",
              eventsMatchLoaded: "\u4E8B\u4EF6\uFF1A{count} \u4E2A\u5339\u914D\uFF08\u5DF2\u52A0\u8F7D {loaded}\uFF09",
              eventsMatch: "\u4E8B\u4EF6\uFF1A{count} \u4E2A\u5339\u914D",
              eventsSelectSession: "\u4E8B\u4EF6\uFF1A\u8BF7\u9009\u62E9 session",
              searchMatchTitle: "\u5DF2\u6E32\u67D3\u7684\u8DF3\u8F6C\u76EE\u6807\uFF1B\u603B\u6570\u4FDD\u7559\u5168\u6587\u547D\u4E2D\u6570\uFF0C\u5E76\u5728\u53EF\u89C1\u76EE\u6807\u66F4\u591A\u65F6\u4E0A\u8C03",
              activeFindFilters: "\u5DF2\u542F\u7528\u7684\u67E5\u627E\u548C\u7B5B\u9009",
              clearAll: "\u5168\u90E8\u6E05\u9664",
              clear: "\u6E05\u9664 {label}",
              find: "\u67E5\u627E",
              readFromHere: "\u4ECE\u8FD9\u91CC\u8BFB",
              readFromHereTitle: "\u6E05\u9664\u4E8B\u4EF6\u7B5B\u9009\u3001\u5207\u56DE\u4E3B\u65F6\u95F4\u7EBF\uFF0C\u5E76\u4FDD\u6301\u5F53\u524D\u4F4D\u7F6E",
              noActiveFilters: "\u6CA1\u6709\u542F\u7528\u67E5\u627E\u6216\u7B5B\u9009",
              foldingStrategy: "\u6298\u53E0\u7B56\u7565",
              strategy: "\u7B56\u7565",
              fixedProfileRules: "\u6298\u53E0\u7B56\u7565\u53EA\u4F5C\u7528\u4E8E\u4E3B\u65F6\u95F4\u7EBF\u3002\u5F53\u524D\u5C42\u7EA7\u4F7F\u7528\u56FA\u5B9A\u663E\u793A\u89C4\u5219\u3002",
              protocolFixedRules: "\u534F\u8BAE\u4E8B\u4EF6\u663E\u793A\u4E3A\u6458\u8981\uFF1B\u975E\u534F\u8BAE\u4E8B\u4EF6\u4FDD\u6301\u6298\u53E0\u3002",
              rawFixedRules: "\u539F\u59CB\u4E8B\u4EF6\u6D88\u606F\u548C\u54CD\u5E94\u6761\u76EE\u8BB0\u5F55\u4FDD\u6301\u6298\u53E0\uFF1B\u5176\u4ED6\u539F\u59CB\u8BB0\u5F55\u663E\u793A\u4E3A\u6458\u8981\u3002",
              viewMainTimeline: "\u67E5\u770B\u4E3B\u65F6\u95F4\u7EBF",
              unsavedPreview: "\u672A\u4FDD\u5B58\u9884\u89C8",
              disabled: "\u7981\u7528",
              default: "\u9ED8\u8BA4",
              eventKinds: "\u4E8B\u4EF6\u7C7B\u578B",
              noExplicitKindRules: "\u6CA1\u6709\u663E\u5F0F\u4E8B\u4EF6\u7C7B\u578B\u89C4\u5219\u3002",
              defaultKindCount: "{count} \u4E2A\u4E8B\u4EF6\u7C7B\u578B\u4F7F\u7528\u9ED8\u8BA4\u8BBE\u7F6E",
              conditions: "\u6761\u4EF6",
              noActiveConditions: "\u6CA1\u6709\u542F\u7528\u7684\u6761\u4EF6\u3002",
              inactiveConditions: "{count} \u4E2A\u672A\u542F\u7528\u6761\u4EF6",
              saveProfileChanges: "\u4FDD\u5B58\u7B56\u7565\u4FEE\u6539",
              cancelProfileChanges: "\u53D6\u6D88\u7B56\u7565\u4FEE\u6539",
              save: "\u4FDD\u5B58",
              back: "\u8FD4\u56DE",
              close: "\u5173\u95ED",
              inspectEvent: "\u68C0\u67E5\u4E8B\u4EF6",
              rawRefs: "\u539F\u59CB\u5F15\u7528",
              noRawRows: "\u6B64\u4E8B\u4EF6\u6CA1\u6709\u53EF\u7528\u7684\u539F\u59CB\u6765\u6E90\u884C\u3002",
              rawRowsForEvent: "{eventId} \u6709 {count} \u6761 JSONL \u884C{plural}",
              rawRows: "{count} \u6761 JSONL \u884C{plural}",
              noRawRefs: "\u6CA1\u6709\u53EF\u7528\u539F\u59CB\u5F15\u7528",
              inspect: "\u68C0\u67E5\u4E8B\u4EF6",
              severity: "\u4E25\u91CD\u6027",
              summary: "\u6458\u8981",
              metadata: "\u5143\u6570\u636E",
              source: "\u6765\u6E90",
              time: "\u65F6\u95F4",
              tool: "\u5DE5\u5177",
              exitCode: "\u9000\u51FA\u7801",
              duration: "\u8017\u65F6",
              recordType: "\u8BB0\u5F55\u7C7B\u578B",
              channels: "\u901A\u9053",
              touchedFiles: "\u6D89\u53CA\u6587\u4EF6",
              details: "\u8BE6\u60C5",
              loadingStructuredDetail: "\u7ED3\u6784\u5316\u8BE6\u60C5\u52A0\u8F7D\u4E2D...",
              retryDetail: "\u91CD\u8BD5\u8BE6\u60C5",
              previousSearchMatch: "\u4E0A\u4E00\u4E2A\u641C\u7D22\u547D\u4E2D",
              nextSearchMatch: "\u4E0B\u4E00\u4E2A\u641C\u7D22\u547D\u4E2D",
              collapseEvent: "\u6536\u8D77\u4E8B\u4EF6",
              expandEvent: "\u5C55\u5F00\u4E8B\u4EF6",
              previous: "\u4E0A\u4E00\u4E2A",
              next: "\u4E0B\u4E00\u4E2A",
              loadingNavigation: "\u5BFC\u822A\u52A0\u8F7D\u4E2D...",
              eventQuickNavigation: "\u4E8B\u4EF6\u5FEB\u901F\u5BFC\u822A",
              quickNavigationCategory: "\u5FEB\u901F\u5BFC\u822A\u7C7B\u522B",
              fixedRuleSubtitle: "{layer} \u4F7F\u7528\u56FA\u5B9A\u663E\u793A\u89C4\u5219",
              remaining: "\u5269\u4F59",
              resets: "\u91CD\u7F6E",
              files: "\u6587\u4EF6",
              raw: "\u539F\u59CB",
              sessionMetadata: "Session \u5143\u6570\u636E",
              reviewKind: "Review",
              subagentKind: "Subagent",
              derivedFrom: "{kind}{nickname} \xB7 \u6765\u81EA {parent}",
              derivedSession: "{kind}{nickname} session",
              forkFrom: "\u5206\u53C9 \xB7 \u6765\u81EA {parent}",
              metricTurns: "\u8F6E\u6B21",
              metricMessages: "\u6D88\u606F",
              metricIssues: "\u95EE\u9898",
              metricFiles: "\u6587\u4EF6",
              metricProtocol: "\u534F\u8BAE",
              metricPlans: "\u8BA1\u5212",
              switchToConversationProfile: "\u5207\u6362\u5230\u5BF9\u8BDD\u9605\u8BFB\u6298\u53E0\u7B56\u7565",
              switchToIssueProfile: "\u5207\u6362\u5230\u9519\u8BEF\u805A\u7126\u6298\u53E0\u7B56\u7565",
              switchToChangesProfile: "\u5207\u6362\u5230\u6539\u52A8\u5BA1\u67E5\u6298\u53E0\u7B56\u7565",
              switchToProtocolLayer: "\u5207\u6362\u5230\u534F\u8BAE\u5C42\u4E8B\u4EF6",
              switchToPlanningProfile: "\u5207\u6362\u5230\u8BA1\u5212\u9605\u8BFB\u6298\u53E0\u7B56\u7565",
              metricShortcutMainOnly: "{label} \u5FEB\u6377\u5165\u53E3\u53EA\u5728\u4E3B\u65F6\u95F4\u7EBF\u53EF\u7528\u3002",
              metricActionCount: "{action}\uFF1A{value} {label}",
              profileInfoEmpty: "\u6682\u65E0\u6298\u53E0\u7B56\u7565\u8BF4\u660E\u3002",
              profileInfoMissingDescription: "\u6682\u65E0\u8BF4\u660E\u3002",
              profileInfoLabel: "\u67E5\u770B\u6298\u53E0\u7B56\u7565\u8BF4\u660E\uFF0C\u5F53\u524D\u7B56\u7565\uFF1A{name}\u3002{description}"
            },
            displayState: {
              expanded: "\u5C55\u5F00",
              summary: "\u6458\u8981",
              collapsed: "\u6298\u53E0",
              hidden: "\u9690\u85CF"
            },
            kind: {
              user_message: "\u7528\u6237\u6D88\u606F",
              assistant_message: "\u52A9\u624B\u6D88\u606F",
              command: "\u547D\u4EE4",
              patch: "\u8865\u4E01",
              mcp_call: "MCP \u8C03\u7528",
              js_repl: "JS REPL",
              other_tool_call: "\u5176\u4ED6\u5DE5\u5177\u8C03\u7528",
              proposed_plan: "\u62DF\u5B9A\u8BA1\u5212",
              plan_update: "\u8BA1\u5212\u66F4\u65B0",
              protocol: "\u534F\u8BAE",
              error: "\u9519\u8BEF",
              warning: "\u8B66\u544A",
              abort: "\u8F6E\u6B21\u4E2D\u6B62",
              rollback: "\u7EBF\u7A0B\u56DE\u6EDA",
              compaction: "\u4E0A\u4E0B\u6587\u538B\u7F29",
              usage_limit_warning: "\u7528\u91CF\u9650\u5236\u8B66\u544A",
              subagent: "Subagent \u6D3B\u52A8",
              review: "Review",
              reasoning: "\u63A8\u7406",
              web_search: "\u7F51\u9875\u641C\u7D22",
              event: "\u4E8B\u4EF6"
            },
            protocol: {
              agents_instructions: "AGENTS.md \u6307\u4EE4",
              developer_collaboration_mode: "\u534F\u4F5C\u6A21\u5F0F",
              developer_instruction: "\u5F00\u53D1\u8005\u6307\u4EE4",
              developer_permissions: "\u5F00\u53D1\u8005\u6743\u9650",
              environment_context: "\u73AF\u5883\u4E0A\u4E0B\u6587",
              session_configured: "Session \u5DF2\u914D\u7F6E",
              task_complete: "\u4EFB\u52A1\u5B8C\u6210",
              task_started: "\u4EFB\u52A1\u5F00\u59CB",
              thread_goal_updated: "\u7EBF\u7A0B\u76EE\u6807\u66F4\u65B0",
              turn_complete: "\u8F6E\u6B21\u5B8C\u6210",
              turn_started: "\u8F6E\u6B21\u5F00\u59CB",
              image_wrapper: "\u56FE\u7247\u9644\u4EF6\u5305\u88C5",
              meta_block: "\u534F\u8BAE\u5143\u6570\u636E\u5757",
              session_meta: "Session \u5143\u6570\u636E",
              skill_injection: "\u6280\u80FD\u6307\u4EE4",
              token_count: "\u8BCD\u5143\u8BA1\u6570",
              turn_aborted_marker: "\u8F6E\u6B21\u4E2D\u6B62\u6807\u8BB0",
              turn_context: "\u8F6E\u6B21\u4E0A\u4E0B\u6587",
              user_shell_command: "\u7528\u6237\u547D\u4EE4\u884C\u547D\u4EE4"
            },
            rawRecord: {
              agent_message: "agent \u6D88\u606F",
              agent_reasoning: "agent \u63A8\u7406",
              context_compacted: "\u4E0A\u4E0B\u6587\u538B\u7F29",
              custom_tool_call: "\u81EA\u5B9A\u4E49\u5DE5\u5177\u8C03\u7528",
              custom_tool_call_output: "\u81EA\u5B9A\u4E49\u5DE5\u5177\u8C03\u7528\u8F93\u51FA",
              dynamic_tool_call_begin: "\u52A8\u6001\u5DE5\u5177\u8C03\u7528\u5F00\u59CB",
              dynamic_tool_call_declined: "\u52A8\u6001\u5DE5\u5177\u8C03\u7528\u5DF2\u62D2\u7EDD",
              dynamic_tool_call_end: "\u52A8\u6001\u5DE5\u5177\u8C03\u7528\u7ED3\u675F",
              entered_review_mode: "\u8FDB\u5165 Review \u6A21\u5F0F",
              event_msg: "\u4E8B\u4EF6\u6D88\u606F",
              exec_command_begin: "\u547D\u4EE4\u6267\u884C\u5F00\u59CB",
              exec_command_declined: "\u547D\u4EE4\u6267\u884C\u5DF2\u62D2\u7EDD",
              exec_command_end: "\u547D\u4EE4\u6267\u884C\u7ED3\u675F",
              exited_review_mode: "\u9000\u51FA Review \u6A21\u5F0F",
              function_call: "function_call",
              function_call_output: "\u51FD\u6570\u8C03\u7528\u8F93\u51FA",
              guardian_warning: "\u5B88\u62A4\u8B66\u544A",
              item_completed: "\u6761\u76EE\u5B8C\u6210",
              mcp_tool_call_begin: "MCP \u5DE5\u5177\u8C03\u7528\u5F00\u59CB",
              message: "\u6D88\u606F",
              patch_apply_begin: "\u8865\u4E01\u5E94\u7528\u5F00\u59CB",
              patch_apply_declined: "\u8865\u4E01\u5E94\u7528\u5DF2\u62D2\u7EDD",
              patch_apply_end: "\u8865\u4E01\u5E94\u7528\u7ED3\u675F",
              plan_delta: "\u8BA1\u5212\u53D8\u66F4",
              plan_update: "\u8BA1\u5212\u66F4\u65B0",
              reasoning: "\u63A8\u7406",
              response_item: "\u54CD\u5E94\u6761\u76EE",
              session_configured: "Session \u5DF2\u914D\u7F6E",
              session_meta: "Session \u5143\u6570\u636E",
              stream_error: "\u6D41\u9519\u8BEF",
              task_complete: "\u4EFB\u52A1\u5B8C\u6210",
              task_started: "\u4EFB\u52A1\u5F00\u59CB",
              thread_goal_updated: "\u7EBF\u7A0B\u76EE\u6807\u66F4\u65B0",
              token_count: "\u8BCD\u5143\u8BA1\u6570",
              turn_complete: "\u8F6E\u6B21\u5B8C\u6210",
              turn_context: "\u8F6E\u6B21\u4E0A\u4E0B\u6587",
              turn_started: "\u8F6E\u6B21\u5F00\u59CB",
              user_message: "\u7528\u6237\u6D88\u606F",
              warning: "\u8B66\u544A",
              web_search_call: "\u7F51\u9875\u641C\u7D22\u8C03\u7528",
              web_search_end: "\u7F51\u9875\u641C\u7D22\u7ED3\u675F"
            },
            status: {
              failed: "\u5931\u8D25",
              success: "\u6210\u529F",
              completed: "\u5DF2\u5B8C\u6210"
            },
            section: {
              Arguments: "\u53C2\u6570",
              Patch: "\u8865\u4E01",
              Output: "\u8F93\u51FA",
              Request: "\u8BF7\u6C42",
              Response: "\u54CD\u5E94",
              "User input": "\u7528\u6237\u8F93\u5165",
              "Image preview": "\u56FE\u7247\u9884\u89C8",
              "Plan update": "\u8BA1\u5212\u66F4\u65B0",
              "Search action": "\u641C\u7D22\u52A8\u4F5C",
              "Search payload": "\u641C\u7D22\u8F7D\u8377",
              "Usage limits": "\u7528\u91CF\u9650\u5236",
              "Token usage": "\u8BCD\u5143\u7528\u91CF",
              "Command arguments": "\u547D\u4EE4\u53C2\u6570",
              "Raw JSON": "\u539F\u59CB JSON",
              "Review request": "Review \u8BF7\u6C42",
              "Review result": "Review \u7ED3\u679C",
              "Overall explanation": "\u603B\u4F53\u8BF4\u660E",
              Findings: "\u53D1\u73B0\u9879",
              "Review output JSON": "Review \u8F93\u51FA JSON",
              "Event fields": "\u4E8B\u4EF6\u5B57\u6BB5",
              "Event raw JSON": "\u4E8B\u4EF6\u539F\u59CB JSON",
              Message: "\u6D88\u606F",
              Plan: "\u8BA1\u5212",
              Reasoning: "\u63A8\u7406",
              Details: "\u8BE6\u60C5",
              Code: "\u4EE3\u7801",
              Question: "\u95EE\u9898",
              Answer: "\u56DE\u7B54",
              Selected: "\u5DF2\u9009\u62E9",
              Targets: "\u76EE\u6807",
              Result: "\u7ED3\u679C"
            },
            foldingCondition: {
              searchHit: ["\u641C\u7D22\u547D\u4E2D", "\u5339\u914D\u5F53\u524D\u641C\u7D22\u8BCD\u7684\u4E8B\u4EF6\u3002"],
              importantEvent: ["\u91CD\u8981\u4E8B\u4EF6", "\u7528\u6237\u548C\u52A9\u624B\u6D88\u606F\u3001\u8865\u4E01\u3001\u9519\u8BEF\u3001\u4E2D\u6B62\u3001\u56DE\u6EDA\u3001\u538B\u7F29\u3001\u8BA1\u5212\u3001\u8BA1\u5212\u66F4\u65B0\u3001\u8BA1\u5212\u5DE5\u5177\u8C03\u7528\u3001\u5931\u8D25\u4E8B\u4EF6\u548C\u5F02\u5E38\u4E25\u91CD\u6027\u7684\u4E8B\u4EF6\u3002"],
              updatePlanCall: ["\u8BA1\u5212\u66F4\u65B0\u8C03\u7528", "\u8BA1\u5212\u5DE5\u5177\u8C03\u7528\u548C\u534F\u8BAE\u5C42\u8BA1\u5212\u66F4\u65B0\u3002"],
              userInputRequest: ["\u7528\u6237\u8F93\u5165\u8BF7\u6C42", "\u5BF9\u8BDD\u4E2D\u6536\u96C6\u7528\u6237\u9009\u62E9\u7684\u8F93\u5165\u8BF7\u6C42\u8C03\u7528\u3002"],
              readableReasoning: ["\u53EF\u8BFB\u63A8\u7406", "\u4E3B\u65F6\u95F4\u7EBF\u4E2D\u5305\u542B\u53EF\u8BFB\u6587\u672C\u7684\u63A8\u7406\u6761\u76EE\u3002"],
              failedStatus: ["\u5931\u8D25\u72B6\u6001", "\u72B6\u6001\u4E3A\u5931\u8D25\u7684\u4E8B\u4EF6\u3002"],
              errorSeverity: ["\u9519\u8BEF\u4E25\u91CD\u6027", "\u4E25\u91CD\u6027\u4E3A\u9519\u8BEF\u7684\u4E8B\u4EF6\u3002"],
              abnormalSeverity: ["\u5F02\u5E38\u4E25\u91CD\u6027", "\u4E25\u91CD\u6027\u4E0D\u662F\u6B63\u5E38\u503C\u7684\u4E8B\u4EF6\u3002"],
              reviewCommand: ["Review \u547D\u4EE4", "\u547D\u4EE4\u9884\u89C8\u4E2D\u5305\u542B\u5E38\u89C1\u9A8C\u8BC1\u6216\u6E90\u7801\u5BA1\u67E5\u8BCD\u7684\u4E8B\u4EF6\u3002"],
              touchedFiles: ["\u6D89\u53CA\u6587\u4EF6", "\u5F15\u7528\u5DF2\u6539\u52A8\u6216\u6D89\u53CA\u6587\u4EF6\u7684\u4E8B\u4EF6\u3002"]
            },
            foldingProfile: {
              narrative: ["\u53D9\u4E8B\u65F6\u95F4\u7EBF", "\u7C7B\u4F3C\u5F00\u53D1\u65F6\u770B\u5230\u7684\u5185\u5BB9\uFF0C\u9002\u5408\u5FEB\u901F\u56DE\u5FC6\u8FD9\u6BB5\u5F00\u53D1\u5230\u5E95\u53D1\u751F\u4E86\u4EC0\u4E48\uFF1A\u76EE\u6807\u600E\u4E48\u63D0\u51FA\u3001\u8FC7\u7A0B\u5982\u4F55\u63A8\u8FDB\u3001\u6700\u540E\u5F97\u5230\u4EC0\u4E48\u7ED3\u679C\u3002"],
              conversation: ["\u5BF9\u8BDD\u9605\u8BFB", "\u5148\u53EA\u770B\u81EA\u7136\u8BED\u8A00\u5185\u5BB9\uFF1A\u9700\u6C42\u63D0\u51FA\u548C\u7EC6\u5316\u8FC7\u7A0B\u3001agent \u62A5\u544A\u7684\u6267\u884C\u8BA1\u5212\u548C\u7ED3\u679C\uFF0C\u6682\u65F6\u8DF3\u8FC7\u5DE5\u5177\u53CA\u4EE3\u7801\u7EC6\u8282\u3002"],
              changes: ["\u6539\u52A8\u5BA1\u67E5", "\u805A\u7126\u6587\u4EF6\u6539\u52A8\uFF1A\u52A8\u4E86\u54EA\u4E9B\u6587\u4EF6\u3001\u505A\u4E86\u54EA\u4E9B\u4FEE\u6539\u3001\u6709\u6CA1\u6709\u8FDB\u884C\u76F8\u5E94 review \u548C\u9A8C\u8BC1\u3002"],
              debug: ["\u9519\u8BEF\u805A\u7126", "\u805A\u7126\u5DE5\u5177\u8C03\u7528\u7B49\u6D41\u7A0B\u4E2D\u7684\u5931\u8D25\u3001\u62A5\u9519\u548C\u4E2D\u65AD\u70B9\uFF0C\u770B\u5F53\u524D\u5DE5\u4F5C\u6D41\u662F\u5426\u5B58\u5728\u6613\u9519\u6A21\u5F0F\u3002"],
              planning: ["\u8BA1\u5212\u9605\u8BFB", "\u9002\u5408\u68C0\u67E5\u4EFB\u52A1\u662F\u5426\u6309\u9884\u671F\u63A8\u8FDB\uFF1A\u8BA1\u5212\u662F\u600E\u6837\u7684\u3001\u6267\u884C\u5230\u54EA\u4E00\u6B65\u3001\u54EA\u4E9B\u610F\u5916\u60C5\u51B5\u53EF\u80FD\u6539\u53D8\u4E86\u4E0B\u4E00\u6B65\u3002"],
              search: ["\u641C\u7D22\u805A\u7126", "\u9002\u5408\u5E26\u7740\u5173\u952E\u8BCD\u9605\u8BFB\uFF1B\u6709\u641C\u7D22\u7ED3\u679C\u65F6\u4F18\u5148\u805A\u7126\u547D\u4E2D\u7247\u6BB5\uFF0C\u907F\u514D\u88AB\u5176\u5B83\u5185\u5BB9\u5E72\u6270\u3002"],
              compact: ["\u5B8C\u6574\u7D27\u51D1", "\u9002\u5408\u62C5\u5FC3\u6F0F\u6389\u7EC6\u8282\u65F6\u626B\u5B8C\u6574\u4E2A\u8FC7\u7A0B\uFF0C\u6240\u6709\u4E8B\u4EF6\u90FD\u4FDD\u7559\uFF0C\u4F46\u9ED8\u8BA4\u6298\u53E0\u5230\u6700\u7701\u7A7A\u95F4\u3002"]
            },
            navigation: {
              search_hits: "\u641C\u7D22\u547D\u4E2D",
              user_messages: "\u7528\u6237\u6D88\u606F",
              assistant_messages: "\u52A9\u624B\u6D88\u606F",
              update_plan: "\u8BA1\u5212\u66F4\u65B0",
              plans: "\u8BA1\u5212\u548C\u66F4\u65B0",
              failed_commands: "\u5931\u8D25\u547D\u4EE4",
              commands: "\u547D\u4EE4",
              patch_applied: "\u8865\u4E01\u5DF2\u5E94\u7528",
              patch_failed: "\u8865\u4E01\u5931\u8D25",
              patches: "\u5168\u90E8\u8865\u4E01",
              errors_warnings: "\u9519\u8BEF\u548C\u8B66\u544A",
              mcp_calls: "MCP \u8C03\u7528",
              web_searches: "\u7F51\u9875\u641C\u7D22"
            },
            renderer: {
              remaining: "\u5269\u4F59",
              resets: "\u91CD\u7F6E",
              selected: "\u5DF2\u9009\u62E9",
              question: "\u95EE\u9898",
              answer: "\u56DE\u7B54",
              unknown: "\u672A\u77E5",
              timedOut: "\u8D85\u65F6",
              message: "\u6D88\u606F",
              result: "\u7ED3\u679C",
              targets: "\u76EE\u6807",
              imageAlt: "\u56FE\u7247\u9884\u89C8",
              imageError: "\u56FE\u7247\u9884\u89C8\u65E0\u6CD5\u52A0\u8F7D\u3002",
              imageUnavailable: "\u56FE\u7247\u9884\u89C8\u4E0D\u53EF\u7528\u3002"
            }
          }
        };
        function resolveLocale(input) {
          const source = String(input || "").split(",")[0].split(";")[0].trim();
          if (!source) return DEFAULT_LOCALE;
          const normalized = source.replace("_", "-").toLowerCase();
          if (normalized === "zh" || normalized === "zh-cn" || normalized.startsWith("zh-hans")) return "zh-CN";
          if (normalized === "en" || normalized.startsWith("en-")) return "en";
          return DEFAULT_LOCALE;
        }
        function readPath(locale, namespace, key) {
          return catalogs[locale]?.[namespace]?.[key];
        }
        function interpolate(text, vars = {}) {
          return String(text).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => Object.hasOwn(vars, name) ? String(vars[name]) : match);
        }
        function t(locale, namespace, key, vars = {}) {
          const resolved = resolveLocale(locale);
          const value = readPath(resolved, namespace, key) ?? readPath(DEFAULT_LOCALE, namespace, key);
          if (value == null) return "";
          return interpolate(value, vars);
        }
        function humanize(value) {
          const text = String(value || "").trim();
          if (!text) return "";
          if (/^mcp\b/i.test(text)) return text.replace(/_/g, " ").replace(/^mcp/i, "MCP");
          return text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/\bJs\b/g, "JS");
        }
        function eventKindLabel(value, locale) {
          const key = String(value || "").trim();
          return t(locale, "kind", key) || t(locale, "protocol", key) || humanize(key) || key;
        }
        function rawRecordLabel(value, locale) {
          const key = String(value || "").trim();
          if (!key) return "";
          const resolved = resolveLocale(locale);
          if (resolved === DEFAULT_LOCALE) return key;
          return readPath(resolved, "rawRecord", key) || readPath(resolved, "protocol", key) || key;
        }
        function displayStateLabel(value, locale) {
          const key = String(value || "").trim();
          return t(locale, "displayState", key) || key;
        }
        function statusLabel(value, locale) {
          const key = String(value || "").trim();
          return t(locale, "status", key) || key;
        }
        function sectionTitle(title, locale) {
          const key = String(title || "").trim();
          return t(locale, "section", key) || key;
        }
        function knownLabel(label, locale) {
          const key = String(label || "").trim();
          return t(locale, "kind", key) || t(locale, "protocol", key) || t(locale, "section", key) || key;
        }
        function localizeCondition(condition, locale) {
          const entry = catalogs[resolveLocale(locale)]?.foldingCondition?.[condition.id] || catalogs[DEFAULT_LOCALE].foldingCondition?.[condition.id];
          return entry ? { ...condition, name: entry[0], description: entry[1] } : { ...condition };
        }
        function localizeProfile(profile, locale) {
          const entry = catalogs[resolveLocale(locale)]?.foldingProfile?.[profile.id] || catalogs[DEFAULT_LOCALE].foldingProfile?.[profile.id];
          return entry ? { ...profile, name: entry[0], description: entry[1] } : { ...profile };
        }
        function localizeSection(section, locale) {
          if (!section || typeof section !== "object") return section;
          const next = { ...section };
          if (next.title) next.title = sectionTitle(next.title, locale);
          return next;
        }
        return {
          DEFAULT_LOCALE,
          SUPPORTED_LOCALES,
          catalogs,
          resolveLocale,
          t,
          eventKindLabel,
          rawRecordLabel,
          displayStateLabel,
          statusLabel,
          sectionTitle,
          knownLabel,
          localizeCondition,
          localizeProfile,
          localizeSection
        };
      });
    }
  });

  // src/browser/renderers.js
  var require_renderers = __commonJS({
    "src/browser/renderers.js"(exports, module) {
      (function initSessionRenderers(root, factory) {
        const commandHighlighting = typeof module === "object" && module.exports ? require_command_highlighting() : root.sessionCommandHighlighting;
        const i18n = typeof module === "object" && module.exports ? require_i18n() : root.sessionI18n;
        const api = factory(commandHighlighting, i18n);
        if (typeof module === "object" && module.exports) module.exports = api;
        root.sessionRenderers = api;
      })(typeof globalThis !== "undefined" ? globalThis : exports, (commandHighlighting, i18n) => {
        "use strict";
        function locale() {
          return globalThis.sessionAnalyzerLocale || i18n.DEFAULT_LOCALE;
        }
        function tr(key, vars = {}) {
          return i18n.t(locale(), "renderer", key, vars);
        }
        function escapeHtml(value) {
          return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
          })[ch]);
        }
        function renderSectionTitle(section) {
          return section.title && !section.hideTitle ? `<div class="sectionTitle">${escapeHtml(section.title)}</div>` : "";
        }
        function renderInlineTitle(section) {
          return escapeHtml(section.title || "Details");
        }
        function normalizeHighlightLanguage(language) {
          const normalized = String(language || "").trim().toLowerCase();
          const aliases = {
            ps1: "powershell",
            pwsh: "powershell",
            shell: "bash",
            sh: "bash",
            zsh: "bash",
            fish: "bash",
            cmd: "bash",
            batch: "bash",
            js: "javascript",
            jsx: "javascript",
            ts: "typescript",
            tsx: "typescript",
            py: "python",
            html: "xml",
            htm: "xml",
            md: "markdown"
          };
          return aliases[normalized] || normalized;
        }
        function escapeRegExp(value) {
          return String(value || "").replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
        }
        const SHELL_EXTERNAL_COMMAND_WORDS = commandHighlighting.SHELL_EXTERNAL_COMMAND_WORDS;
        const SHELL_EXTERNAL_COMMAND_REGEX_SOURCE = SHELL_EXTERNAL_COMMAND_WORDS.map(escapeRegExp).join("|");
        const SHELL_EXTERNAL_COMMAND_PATTERN = SHELL_EXTERNAL_COMMAND_WORDS.length ? new RegExp(`([\\r\\n;|{}()]|&amp;)([ \\t]*)(${SHELL_EXTERNAL_COMMAND_REGEX_SOURCE})(\\.exe)?(?=\\s|$)`, "gi") : null;
        const SHELL_EXTERNAL_COMMAND_LINE_START_PATTERN = SHELL_EXTERNAL_COMMAND_WORDS.length ? new RegExp(`^([ \\t]*)(${SHELL_EXTERNAL_COMMAND_REGEX_SOURCE})(\\.exe)?(?=\\s|$)`, "i") : null;
        const BASH_OPTION_PATTERN = /(^|[\s])(-{1,2}[A-Za-z0-9][A-Za-z0-9-]*)(?=\s|$)/g;
        const HLJS_SPAN_CLASS_PATTERN = /\bclass=(["'])[^"']*\bhljs-[^"']*\1/i;
        function textEndsAtLineStart(text, startsAtLineStart = false) {
          const source = String(text || "");
          const index = Math.max(source.lastIndexOf("\n"), source.lastIndexOf("\r"));
          if (index < 0) return startsAtLineStart && /^[ \t]*$/.test(source);
          return /^[ \t]*$/.test(source.slice(index + 1));
        }
        function highlightExternalCommandWordsInText(htmlText, startsAtLineStart = false) {
          if (!SHELL_EXTERNAL_COMMAND_PATTERN) return String(htmlText || "");
          let output = String(htmlText || "").replace(SHELL_EXTERNAL_COMMAND_PATTERN, (_match, prefix, spacing, command, extension = "") => `${prefix}${spacing}<span class="hljs-built_in">${command}${extension}</span>`);
          if (startsAtLineStart && SHELL_EXTERNAL_COMMAND_LINE_START_PATTERN) {
            output = output.replace(SHELL_EXTERNAL_COMMAND_LINE_START_PATTERN, (_match, spacing, command, extension = "") => `${spacing}<span class="hljs-built_in">${command}${extension}</span>`);
          }
          return output;
        }
        function mapHighlightTextSegments(html, mapper, initialState = {}, protectedMapper = null) {
          const source = String(html || "");
          let output = "";
          let cursor = 0;
          let hljsSpanDepth = 0;
          const state = { ...initialState };
          const tagPattern = /<\/?span\b[^>]*>|<[^>]*>/gi;
          for (const match of source.matchAll(tagPattern)) {
            const text = source.slice(cursor, match.index);
            if (hljsSpanDepth) {
              if (protectedMapper) protectedMapper(text, state);
              output += text;
            } else {
              output += mapper(text, state);
            }
            const tag = match[0];
            output += tag;
            if (/^<span\b/i.test(tag) && HLJS_SPAN_CLASS_PATTERN.test(tag)) hljsSpanDepth += 1;
            else if (/^<\/span\b/i.test(tag) && hljsSpanDepth > 0) hljsSpanDepth -= 1;
            cursor = match.index + tag.length;
          }
          const tail = source.slice(cursor);
          if (hljsSpanDepth) {
            if (protectedMapper) protectedMapper(tail, state);
            output += tail;
          } else {
            output += mapper(tail, state);
          }
          return output;
        }
        function highlightExternalCommandWords(html) {
          return mapHighlightTextSegments(html, (text, state) => {
            const output = highlightExternalCommandWordsInText(text, state.atLineStart);
            if (text) state.atLineStart = textEndsAtLineStart(text, state.atLineStart);
            return output;
          }, { atLineStart: true }, (text, state) => {
            if (text) state.atLineStart = textEndsAtLineStart(text, state.atLineStart);
          });
        }
        function unhighlightBashBuiltinsInWindowsPaths(html) {
          return String(html || "").replace(/<span class="hljs-built_in">([^<]+)<\/span>(\\[^\s<]*)/g, "$1$2");
        }
        function highlightBashOptionsInText(htmlText) {
          return String(htmlText || "").replace(BASH_OPTION_PATTERN, (_match, prefix, option) => `${prefix}<span class="hljs-literal">${option}</span>`);
        }
        function highlightBashOptions(html) {
          return mapHighlightTextSegments(html, (text) => highlightBashOptionsInText(text));
        }
        function languageForPath(filePath) {
          const ext = String(filePath || "").toLowerCase().split(/[\\/]/).pop().split(".").pop();
          const languages = {
            js: "javascript",
            jsx: "javascript",
            mjs: "javascript",
            cjs: "javascript",
            ts: "typescript",
            tsx: "typescript",
            json: "json",
            py: "python",
            ps1: "powershell",
            sh: "bash",
            bash: "bash",
            zsh: "bash",
            css: "css",
            scss: "css",
            html: "xml",
            htm: "xml",
            xml: "xml",
            svg: "xml",
            diff: "diff",
            patch: "diff"
          };
          return languages[ext] || "";
        }
        function highlightCode(value, language) {
          const source = String(value || "");
          const hljs = globalThis.hljs;
          const normalized = normalizeHighlightLanguage(language);
          if (!hljs || !normalized || !hljs.getLanguage?.(normalized)) return escapeHtml(source);
          try {
            const highlighted = hljs.highlight(source, { language: normalized, ignoreIllegals: true }).value;
            if (normalized === "powershell") return highlightExternalCommandWords(highlighted);
            if (normalized === "bash") return unhighlightBashBuiltinsInWindowsPaths(highlightBashOptions(highlightExternalCommandWords(highlighted)));
            return highlighted;
          } catch {
            return escapeHtml(source);
          }
        }
        function renderMarkdown(section) {
          return `<section class="eventSection mdBlock">${renderSectionTitle(section)}${section.html || ""}</section>`;
        }
        function renderCode(section) {
          const language = section.language || "text";
          const languageClass = `language-${escapeHtml(language)}`;
          const title = section.title ? `<span>${escapeHtml(section.title)}</span>` : "<span>Code</span>";
          return `<section class="eventSection"><div class="codeFence"><div class="codeFenceHead">${title}<code>${escapeHtml(language)}</code></div><pre><code class="${languageClass} hljs">${highlightCode(section.code || "", language)}</code></pre></div></section>`;
        }
        function renderTerminal(section) {
          const stream = section.stream === "stderr" ? "stderr" : "stdout";
          const language = section.language || "text";
          const title = section.title || stream;
          return `<section class="eventSection"><div class="codeFence terminalBlock ${stream}"><div class="codeFenceHead"><span>${escapeHtml(title)}</span><code>${escapeHtml(language)}</code></div><pre><code class="language-${escapeHtml(language)}">${escapeHtml(section.text || "")}</code></pre></div></section>`;
        }
        function isCommandSection(section) {
          return section?.type === "code" && String(section.title || "").toLowerCase() === "command";
        }
        function isTerminalOutputSection(section) {
          return section?.type === "terminal" && ["stdout", "stderr"].includes(section.stream || section.title);
        }
        function renderCommandRunSegment(section, role) {
          const stream = section.stream === "stderr" ? "stderr" : "stdout";
          const language = section.language || "text";
          const title = section.title || (role === "command" ? "Command" : stream);
          const source = role === "command" ? section.code : section.text;
          const roleClass = role === "command" ? "commandRunCommand" : `commandRunOutput ${stream}`;
          const code = role === "command" ? highlightCode(source || "", language) : escapeHtml(source || "");
          const highlightClass = role === "command" ? " hljs" : "";
          return `<div class="commandRunSegment ${roleClass}"><div class="commandRunHead"><span>${escapeHtml(title)}</span><code>${escapeHtml(language)}</code></div><pre><code class="language-${escapeHtml(language)}${highlightClass}">${code}</code></pre></div>`;
        }
        function renderCommandRun(sections) {
          const body = sections.map((section, index) => renderCommandRunSegment(section, index === 0 ? "command" : "output")).join("");
          return `<section class="eventSection commandRun">${body}</section>`;
        }
        function renderJson(section) {
          return `<section class="eventSection"><div class="jsonBlock">${renderSectionTitle(section)}<pre>${escapeHtml(JSON.stringify(section.value, null, 2))}</pre></div></section>`;
        }
        function renderDiff(section) {
          const lines = String(section.text || "").split(/\r?\n/).map((line) => {
            let cls = "context";
            if (line.startsWith("+") && !line.startsWith("+++")) cls = "added";
            else if (line.startsWith("-") && !line.startsWith("---")) cls = "removed";
            else if (line.startsWith("@@")) cls = "hunk";
            return `<span class="diffLine ${cls}">${escapeHtml(line)}</span>`;
          }).join("");
          return `<section class="eventSection"><div class="diffBlock">${renderSectionTitle(section)}<pre>${lines}</pre></div></section>`;
        }
        function renderPatch(section) {
          const files = (section.files || []).map((file) => {
            const language = languageForPath(file.path);
            const hunks = (file.hunks || []).map((hunk) => {
              const header = hunk.header ? `<div class="patchHunkHeader">${escapeHtml(hunk.header)}</div>` : "";
              const lines = (hunk.lines || []).map((line) => {
                const sign = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
                const oldNo = line.oldLine == null ? "" : String(line.oldLine);
                const newNo = line.newLine == null ? "" : String(line.newLine);
                const reliableLineNumber = line.lineNumberReliable !== false && hunk.lineNumbers !== false && file.lineNumbers !== false;
                const lineNo = reliableLineNumber ? line.kind === "added" ? newNo : line.kind === "removed" ? oldNo : newNo || oldNo : "";
                const lineNoClass = reliableLineNumber ? "patchLineNo" : "patchLineNo muted";
                return `<div class="patchLine ${escapeHtml(line.kind || "context")}"><span class="${lineNoClass}">${escapeHtml(lineNo)}</span><span class="patchSign">${sign}</span><code class="${language ? `language-${escapeHtml(language)} hljs` : ""}">${highlightCode(line.content || "", language)}</code></div>`;
              }).join("");
              return `<div class="patchHunk">${header}${lines}</div>`;
            }).join("");
            return `<article class="patchFile"><header><strong>${escapeHtml(file.path || "")}</strong><span>${escapeHtml(file.changeType || "update")}</span><em>+${escapeHtml(file.additions || 0)} / -${escapeHtml(file.deletions || 0)}</em></header>${hunks}</article>`;
          }).join("");
          return `<section class="eventSection patchBlock">${files}</section>`;
        }
        function renderKv(section) {
          const rows = (section.entries || []).map((entry) => `<tr><th>${escapeHtml(entry.key || "")}</th><td>${escapeHtml(entry.value || "")}</td></tr>`).join("");
          return `<section class="eventSection"><div class="kvWrap">${renderSectionTitle(section)}<table class="kvTable"><tbody>${rows}</tbody></table></div></section>`;
        }
        function renderTokenUsage(section) {
          const items = (section.items || []).map((item) => {
            const primary = item.primary ? " primary" : "";
            return `<div class="tokenUsageItem${primary}"><span class="tokenUsageLabel">${escapeHtml(item.label || "")}</span><strong>${escapeHtml(item.formatted ?? item.value ?? "")}</strong></div>`;
          }).join("");
          return `<section class="eventSection"><div class="tokenUsageBlock">${renderSectionTitle(section)}<div class="tokenUsageGrid">${items}</div></div></section>`;
        }
        function renderUsageLimits(section) {
          const items = (section.items || []).map((item) => `<div class="usageLimitItem"><strong>${escapeHtml(item.label || "")}</strong><span>${escapeHtml(item.remaining || "")} ${escapeHtml(tr("remaining"))}</span><em>${escapeHtml(tr("resets"))} ${escapeHtml(item.reset || "")}</em></div>`).join("");
          return `<section class="eventSection"><div class="usageLimitBlock">${renderSectionTitle(section)}${items}</div></section>`;
        }
        function renderUserInput(section) {
          const questions = (section.questions || []).map((question) => {
            const options = (question.options || []).map((option) => {
              const selected = option.selected ? " selected" : "";
              const selectedLabel = option.selected ? `<span class="userInputSelected">${escapeHtml(tr("selected"))}</span>` : "";
              return `<li class="userInputOption${selected}"><div><strong>${escapeHtml(option.label || "")}</strong>${selectedLabel}</div>${option.description ? `<p>${escapeHtml(option.description)}</p>` : ""}</li>`;
            }).join("");
            const answers = (question.answers || []).map((answer) => `<span>${escapeHtml(answer)}</span>`).join("");
            return `<article class="userInputQuestion"><header><strong>${escapeHtml(question.title || tr("question"))}</strong></header>${question.prompt ? `<p class="userInputPrompt">${escapeHtml(question.prompt)}</p>` : ""}${options ? `<ul class="userInputOptions">${options}</ul>` : ""}${answers ? `<div class="userInputAnswer"><strong>${escapeHtml(tr("answer"))}</strong>${answers}</div>` : ""}</article>`;
          }).join("");
          return `<section class="eventSection"><div class="userInputBlock">${renderSectionTitle(section)}${questions}</div></section>`;
        }
        function planStatusClass(status) {
          const normalized = String(status || "").trim().toLowerCase();
          if (normalized === "completed") return " completed";
          if (normalized === "in_progress") return " inProgress";
          if (normalized === "pending") return " pending";
          if (normalized === "failed" || normalized === "blocked") return " blocked";
          return " unknown";
        }
        function renderPlanUpdate(section) {
          const explanation = section.explanationHtml ? `<div class="planUpdateExplanation">${section.explanationHtml}</div>` : "";
          const steps = (section.steps || []).map((item) => `<li class="planUpdateStep"><span class="planStatus${planStatusClass(item.status)}">${escapeHtml(item.status || tr("unknown"))}</span><span>${escapeHtml(item.step || "")}</span></li>`).join("");
          return `<section class="eventSection"><div class="planUpdateBlock">${renderSectionTitle(section)}${explanation}${steps ? `<ol class="planUpdateSteps">${steps}</ol>` : ""}</div></section>`;
        }
        function collaborationStatusClass(status) {
          const normalized = String(status || "").trim().toLowerCase();
          if (normalized === "completed" || normalized === "success") return " completed";
          if (normalized === "running" || normalized === "in_progress") return " running";
          if (normalized === "pending" || normalized === "pending_init") return " pending";
          if (normalized === "failed" || normalized === "blocked" || normalized === "declined") return " failed";
          return " unknown";
        }
        function renderCollaboration(section) {
          const targets = (section.targets || []).map((target) => `<span>${escapeHtml(target)}</span>`).join("");
          const fields = (section.fields || []).map((entry) => `<div><dt>${escapeHtml(entry.key || "")}</dt><dd>${escapeHtml(entry.value || "")}</dd></div>`).join("");
          const statuses = (section.statuses || []).map((item) => `<li><span>${escapeHtml(item.label || "")}</span><strong class="collaborationStatus${collaborationStatusClass(item.status)}">${escapeHtml(item.status || tr("unknown"))}</strong></li>`).join("");
          const timedOut = section.timedOut ? `<span class="collaborationStatus failed">${escapeHtml(tr("timedOut"))}</span>` : "";
          const message = section.messageHtml ? `<article class="collaborationBody"><h4>${escapeHtml(tr("message"))}</h4><div>${section.messageHtml}</div></article>` : "";
          const result = section.resultHtml ? `<article class="collaborationBody"><h4>${escapeHtml(tr("result"))}</h4><div>${section.resultHtml}</div></article>` : "";
          return `<section class="eventSection"><div class="collaborationBlock">${renderSectionTitle(section)}${targets ? `<div class="collaborationTargets"><strong>${escapeHtml(tr("targets"))}</strong>${targets}</div>` : ""}${fields ? `<dl class="collaborationFields">${fields}</dl>` : ""}${statuses || timedOut ? `<div class="collaborationStatuses">${timedOut}${statuses ? `<ul>${statuses}</ul>` : ""}</div>` : ""}${message}${result}</div></section>`;
        }
        function isSafeImagePreviewUrl(value) {
          return /^\/api\/sessions\/[^/?#]+\/events\/[^/?#]+\/image-previews\/[^/?#]+$/.test(String(value || ""));
        }
        function renderImagePreview(section) {
          const images = (section.images || []).filter((image) => isSafeImagePreviewUrl(image.src)).map((image) => `<figure><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || tr("imageAlt"))}" loading="lazy" decoding="async"><p class="imagePreviewError">${escapeHtml(tr("imageError"))}</p>${image.detail ? `<figcaption>${escapeHtml(image.detail)}</figcaption>` : ""}</figure>`).join("");
          const notice = section.notice || (!images ? tr("imageUnavailable") : "");
          const noticeHtml = notice ? `<div class="notice info"><p>${escapeHtml(notice)}</p></div>` : "";
          return `<section class="eventSection"><div class="imagePreviewBlock">${renderSectionTitle(section)}${images ? `<div class="imagePreviewGrid">${images}</div>` : ""}${noticeHtml}</div></section>`;
        }
        function renderNotice(section) {
          const level = section.level || "info";
          return `<section class="eventSection"><div class="notice ${escapeHtml(level)}">${renderSectionTitle(section)}<p>${escapeHtml(section.text || "")}</p></div></section>`;
        }
        function renderRawJson(section) {
          const open = section.expanded ? " open" : "";
          return `<section class="eventSection"><details class="rawJsonDetails"${open}><summary>${renderInlineTitle(section)}</summary><div class="jsonBlock"><pre>${escapeHtml(JSON.stringify(section.value, null, 2))}</pre></div></details></section>`;
        }
        function renderSection(section) {
          if (!section || !section.type) return "";
          switch (section.type) {
            case "markdown":
              return renderMarkdown(section);
            case "code":
              return renderCode(section);
            case "terminal":
              return renderTerminal(section);
            case "json":
              return renderJson(section);
            case "diff":
              return renderDiff(section);
            case "patch":
              return renderPatch(section);
            case "kv":
              return renderKv(section);
            case "token_usage":
              return renderTokenUsage(section);
            case "usage_limits":
              return renderUsageLimits(section);
            case "user_input":
              return renderUserInput(section);
            case "plan_update":
              return renderPlanUpdate(section);
            case "collaboration":
              return renderCollaboration(section);
            case "image_preview":
              return renderImagePreview(section);
            case "notice":
              return renderNotice(section);
            case "raw_json":
              return renderRawJson(section);
            default:
              return renderRawJson({ title: section.title || "Raw JSON", value: section.value || section });
          }
        }
        function renderSections(sections) {
          const output = [];
          const items = sections || [];
          for (let index = 0; index < items.length; index += 1) {
            const section = items[index];
            if (isCommandSection(section)) {
              const commandSections = [section];
              let cursor = index + 1;
              while (cursor < items.length && isTerminalOutputSection(items[cursor])) {
                commandSections.push(items[cursor]);
                cursor += 1;
              }
              output.push(renderCommandRun(commandSections));
              index = cursor - 1;
            } else {
              output.push(renderSection(section));
            }
          }
          return output.join("");
        }
        function renderTimelineSections(sections, fallbackPreview = "") {
          const body = renderSections(sections);
          if (body) return body;
          const preview = String(fallbackPreview || "").trim();
          return preview ? `<div class="eventPreview eventExpandedFallback">${escapeHtml(preview)}</div>` : "";
        }
        return {
          escapeHtml,
          renderSection,
          renderSections,
          renderTimelineSections
        };
      });
    }
  });

  // src/browser/search-query.js
  var require_search_query = __commonJS({
    "src/browser/search-query.js"(exports, module) {
      (function initSearchQuery(root, factory) {
        const api = factory();
        if (typeof module === "object" && module.exports) module.exports = api;
        root.sessionSearchQuery = api;
      })(typeof globalThis !== "undefined" ? globalThis : window, function createSearchQueryApi() {
        "use strict";
        const OPERATOR_VALUES = {
          layer: /* @__PURE__ */ new Set(["main", "protocol", "raw"]),
          status: /* @__PURE__ */ new Set(["failed", "success", "completed"])
        };
        const OPERATORS = /* @__PURE__ */ new Set(["file", "kind", "status", "layer"]);
        function tokenize(input) {
          const source = String(input || "");
          const tokens = [];
          let i = 0;
          while (i < source.length) {
            while (i < source.length && /\s/.test(source[i])) i += 1;
            if (i >= source.length) break;
            const start = i;
            let quoted = false;
            while (i < source.length) {
              const ch = source[i];
              if (ch === '"') quoted = !quoted;
              if (!quoted && /\s/.test(ch)) break;
              i += 1;
            }
            tokens.push({ raw: source.slice(start, i) });
          }
          return tokens;
        }
        function unquote(value) {
          const text = String(value || "").trim();
          if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
            return text.slice(1, -1);
          }
          return text.replace(/^"+|"+$/g, "");
        }
        function parseOperatorToken(raw) {
          const colon = String(raw || "").indexOf(":");
          if (colon <= 0) return null;
          const operator = raw.slice(0, colon).toLowerCase();
          if (!OPERATORS.has(operator)) return null;
          const rawValue = raw.slice(colon + 1);
          const value = operator === "file" ? unquote(rawValue) : unquote(rawValue).toLowerCase();
          if (!value) return { operator, value: "", valid: true, empty: true };
          if (OPERATOR_VALUES[operator] && !OPERATOR_VALUES[operator].has(value)) return null;
          return { operator, value, valid: true, empty: false };
        }
        function parseSearchInput(input) {
          const filters = { q: "", file: "", kind: "", status: "", layer: "" };
          const text = [];
          const tokens = tokenize(input).map((token) => {
            const parsed = parseOperatorToken(token.raw);
            if (parsed?.valid) {
              if (!parsed.empty) filters[parsed.operator] = parsed.value;
              return { ...token, ...parsed };
            }
            text.push(unquote(token.raw));
            return { ...token, operator: "", value: unquote(token.raw), valid: false, empty: false };
          });
          filters.q = text.filter(Boolean).join(" ").trim();
          return { ...filters, tokens };
        }
        function formatOperatorValue(value) {
          const text = String(value || "");
          return /\s/.test(text) ? `"${text.replace(/"/g, "")}"` : text;
        }
        function joinTokens(tokens) {
          return tokens.map((token) => token.raw).filter(Boolean).join(" ").trim();
        }
        function removeOperator(input, operator) {
          return joinTokens(tokenize(input).filter((token) => parseOperatorToken(token.raw)?.operator !== operator));
        }
        function removeFreeText(input) {
          return joinTokens(tokenize(input).filter((token) => parseOperatorToken(token.raw)?.valid));
        }
        function upsertOperator(input, operator, value) {
          const cleaned = removeOperator(input, operator);
          const expression = `${operator}:${formatOperatorValue(value)}`;
          return [cleaned, expression].filter(Boolean).join(" ").trim();
        }
        function structuredSearchKey(filters, layerId = "", sortValue = "") {
          const search = filters || {};
          return [
            search.kind || "",
            search.status || "",
            search.file || "",
            search.layer || "",
            layerId || "",
            sortValue || ""
          ].join("");
        }
        return {
          parseSearchInput,
          removeFreeText,
          removeOperator,
          structuredSearchKey,
          upsertOperator
        };
      });
    }
  });

  // src/browser/highlight.js
  var require_highlight = __commonJS({
    "src/browser/highlight.js"(exports, module) {
      (function initSessionSearchHighlighter(root, factory) {
        const api = factory();
        if (typeof module === "object" && module.exports) module.exports = api;
        root.sessionSearchHighlighter = api;
      })(typeof globalThis !== "undefined" ? globalThis : exports, () => {
        "use strict";
        const SKIP_SELECTOR = "script, style, textarea, input, select, option, button, mark, a";
        function searchTerms(query) {
          const phrase = String(query || "").trim();
          return phrase ? [phrase] : [];
        }
        function displayedMatchTotal(fullTextTotal, renderedMarkCount) {
          const full = Number.isFinite(Number(fullTextTotal)) ? Math.max(0, Number(fullTextTotal)) : 0;
          const rendered = Number.isFinite(Number(renderedMarkCount)) ? Math.max(0, Number(renderedMarkCount)) : 0;
          return Math.max(full, rendered);
        }
        function phraseRegex(query, flags = "") {
          const phrase = String(query || "").trim();
          if (!phrase) return null;
          const pattern = phrase.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
          return new RegExp(pattern, flags.includes("i") ? flags : `${flags}i`);
        }
        function highlightedParts(text, terms) {
          const source = String(text || "");
          const regex = phraseRegex((terms || []).join(" "), "g");
          if (!source || !regex) return [{ text: source, match: false }];
          const parts = [];
          let plainStart = 0;
          for (const match of source.matchAll(regex)) {
            if (plainStart < match.index) parts.push({ text: source.slice(plainStart, match.index), match: false });
            parts.push({ text: match[0], match: true });
            plainStart = match.index + match[0].length;
          }
          if (plainStart < source.length) parts.push({ text: source.slice(plainStart), match: false });
          return parts.length ? parts : [{ text: source, match: false }];
        }
        function clear(rootNode) {
          if (!rootNode?.querySelectorAll) return;
          const marks = [...rootNode.querySelectorAll("mark.searchMark")];
          for (const mark of marks) {
            const text = rootNode.ownerDocument.createTextNode(mark.textContent || "");
            mark.replaceWith(text);
            text.parentNode?.normalize();
          }
        }
        function textNodeAccepted(node, terms) {
          const parent = node.parentElement;
          if (!parent || parent.closest(SKIP_SELECTOR)) return false;
          const text = node.nodeValue || "";
          if (!text.trim()) return false;
          return Boolean(phraseRegex((terms || []).join(" "))?.test(text));
        }
        function apply(rootNode, terms) {
          if (!rootNode?.ownerDocument || !terms?.length) return [];
          const doc = rootNode.ownerDocument;
          const walker = doc.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              return textNodeAccepted(node, terms) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
          });
          const nodes = [];
          while (walker.nextNode()) nodes.push(walker.currentNode);
          const marks = [];
          for (const textNode of nodes) {
            const parts = highlightedParts(textNode.nodeValue || "", terms);
            if (!parts.some((part) => part.match)) continue;
            const fragment = doc.createDocumentFragment();
            for (const part of parts) {
              if (!part.text) continue;
              if (!part.match) {
                fragment.appendChild(doc.createTextNode(part.text));
                continue;
              }
              const mark = doc.createElement("mark");
              mark.className = "searchMark";
              mark.textContent = part.text;
              marks.push(mark);
              fragment.appendChild(mark);
            }
            textNode.replaceWith(fragment);
          }
          return marks;
        }
        function reveal(mark, options = {}) {
          if (!mark?.scrollIntoView) return false;
          let details = mark.closest?.("details");
          while (details) {
            details.open = true;
            details = details.parentElement?.closest?.("details");
          }
          mark.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "smooth",
            ...options
          });
          return true;
        }
        return {
          apply,
          clear,
          displayedMatchTotal,
          highlightedParts,
          reveal,
          searchTerms
        };
      });
    }
  });

  // src/shared/folding.js
  var require_folding = __commonJS({
    "src/shared/folding.js"(exports, module) {
      (function initFolding(root, factory) {
        const api = factory();
        if (typeof module === "object" && module.exports) module.exports = api;
        root.sessionFolding = api;
      })(typeof globalThis !== "undefined" ? globalThis : window, function createFoldingApi() {
        "use strict";
        const DISPLAY_STATES = ["expanded", "summary", "collapsed", "hidden"];
        const CONDITION_DISPLAY_STATES = ["expanded", "summary"];
        const DISPLAY_STATE_PRIORITY = {
          hidden: 0,
          collapsed: 1,
          summary: 2,
          expanded: 3
        };
        const EDITABLE_EVENT_KINDS = [
          "user_message",
          "assistant_message",
          "proposed_plan",
          "reasoning",
          "command",
          "patch",
          "mcp_call",
          "js_repl",
          "other_tool_call",
          "web_search",
          "error",
          "warning",
          "abort",
          "rollback",
          "compaction",
          "usage_limit_warning",
          "subagent",
          "review"
        ];
        const CONDITION_DEFINITIONS = [
          {
            id: "searchHit",
            name: "Search hit",
            description: "Events matching the current search query."
          },
          {
            id: "importantEvent",
            name: "Important event",
            description: "User/assistant messages, patches, errors, aborts, rollbacks, compactions, plans, plan updates, update_plan calls, failed events, and abnormal severity."
          },
          {
            id: "updatePlanCall",
            name: "update_plan call",
            description: "Calls to the update_plan tool and protocol plan updates."
          },
          {
            id: "userInputRequest",
            name: "User input request",
            description: "Calls to request_user_input that collect user choices during a conversation."
          },
          {
            id: "readableReasoning",
            name: "Readable reasoning",
            description: "Reasoning entries that contain readable text in the Main timeline."
          },
          {
            id: "failedStatus",
            name: "Failed status",
            description: "Events whose status is failed."
          },
          {
            id: "errorSeverity",
            name: "Error severity",
            description: "Events whose severity is error."
          },
          {
            id: "abnormalSeverity",
            name: "Abnormal severity",
            description: "Events whose severity is not normal."
          },
          {
            id: "reviewCommand",
            name: "Review command",
            description: "Command previews containing common verification or source-control review terms."
          },
          {
            id: "touchedFiles",
            name: "Touched files",
            description: "Events that reference changed or touched files."
          }
        ];
        const CONDITION_IDS = new Set(CONDITION_DEFINITIONS.map((condition) => condition.id));
        function isUpdatePlanEvent(event = {}) {
          return event.kind === "plan_update" || event.toolName === "update_plan" || event.subtype === "update_plan" || event.label === "update_plan";
        }
        function isUserInputRequestEvent(event = {}) {
          return event.toolName === "request_user_input" || event.subtype === "request_user_input" || event.label === "request_user_input";
        }
        function moreVisibleState(left, right) {
          return DISPLAY_STATE_PRIORITY[left] >= DISPLAY_STATE_PRIORITY[right] ? left : right;
        }
        function normalizeRules(rules) {
          const source = rules && typeof rules === "object" ? rules : {};
          const kindStates = /* @__PURE__ */ Object.create(null);
          for (const [kind, display] of Object.entries(source.kindStates || {}).sort(([left], [right]) => left.localeCompare(right))) {
            if (DISPLAY_STATES.includes(display)) kindStates[kind] = display;
          }
          const fallback = DISPLAY_STATES.includes(source.fallback) ? source.fallback : "summary";
          const conditionStates = /* @__PURE__ */ new Map();
          for (const condition of Array.isArray(source.conditions) ? source.conditions : []) {
            const id = String(condition?.id || "");
            const display = condition?.state;
            if (!CONDITION_IDS.has(id) || !CONDITION_DISPLAY_STATES.includes(display)) continue;
            conditionStates.set(id, conditionStates.has(id) ? moreVisibleState(conditionStates.get(id), display) : display);
          }
          const conditions = CONDITION_DEFINITIONS.filter((condition) => conditionStates.has(condition.id)).map((condition) => ({ id: condition.id, state: conditionStates.get(condition.id) }));
          return { kindStates, fallback, conditions };
        }
        function importantEvent(event = {}) {
          return ["user_message", "assistant_message", "patch", "error", "warning", "abort", "rollback", "compaction", "proposed_plan", "review"].includes(event.kind) || isUpdatePlanEvent(event) || event.severity !== "normal" || event.status === "failed";
        }
        function conditionMatches(conditionId, event = {}) {
          if (conditionId === "searchHit") return Boolean(event.hasSearchHit);
          if (conditionId === "importantEvent") return importantEvent(event);
          if (conditionId === "updatePlanCall") return isUpdatePlanEvent(event);
          if (conditionId === "userInputRequest") return isUserInputRequestEvent(event);
          if (conditionId === "readableReasoning") return event.kind === "reasoning" && Boolean(event.hasReadableReasoning);
          if (conditionId === "failedStatus") return event.status === "failed";
          if (conditionId === "errorSeverity") return event.severity === "error";
          if (conditionId === "abnormalSeverity") return event.severity !== "normal";
          if (conditionId === "reviewCommand") return event.kind === "command" && /\b(test|tests|build|lint|typecheck|check|compile|compileall|pytest|unittest|vitest|jest|mocha|ruff|eslint|biome|tsc|mypy|pyright|clippy|vet|git|diff|status)\b/i.test(event.preview || "");
          if (conditionId === "touchedFiles") return Boolean(event.touchedFiles?.length);
          return false;
        }
        function displayStateFromRules(event = {}, rules) {
          const normalized = normalizeRules(rules);
          const matches = [];
          if (Object.hasOwn(normalized.kindStates, event.kind)) matches.push(normalized.kindStates[event.kind]);
          for (const condition of normalized.conditions) {
            if (conditionMatches(condition.id, event)) matches.push(condition.state);
          }
          return matches.reduce(moreVisibleState, null) || normalized.fallback;
        }
        function normalizeOverrides(overrides) {
          const normalized = /* @__PURE__ */ Object.create(null);
          if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return normalized;
          for (const [sessionId, eventStates] of Object.entries(overrides)) {
            if (!eventStates || typeof eventStates !== "object" || Array.isArray(eventStates)) continue;
            const validEventStates = /* @__PURE__ */ Object.create(null);
            for (const [eventId, display] of Object.entries(eventStates)) {
              if (DISPLAY_STATES.includes(display)) validEventStates[eventId] = display;
            }
            if (Object.keys(validEventStates).length) normalized[sessionId] = validEventStates;
          }
          return normalized;
        }
        return {
          DISPLAY_STATES,
          CONDITION_DISPLAY_STATES,
          DISPLAY_STATE_PRIORITY,
          EDITABLE_EVENT_KINDS,
          CONDITION_DEFINITIONS,
          isUpdatePlanEvent,
          isUserInputRequestEvent,
          normalizeRules,
          conditionMatches,
          displayStateFromRules,
          normalizeOverrides
        };
      });
    }
  });

  // src/browser/navigation.js
  var require_navigation = __commonJS({
    "src/browser/navigation.js"(exports, module) {
      (function initNavigation(root, factory) {
        const folding = typeof module === "object" && module.exports ? require_folding() : root.sessionFolding;
        const api = factory(folding);
        if (typeof module === "object" && module.exports) module.exports = api;
        root.sessionNavigation = api;
      })(typeof globalThis !== "undefined" ? globalThis : window, function createNavigationApi(folding) {
        "use strict";
        const isUpdatePlanEvent = folding.isUpdatePlanEvent;
        const NAVIGATION_CATEGORIES = [
          { id: "search_hits", label: "Search hits", matches: (event) => Boolean(event.hasSearchHit) },
          { id: "user_messages", label: "User messages", matches: (event) => event.kind === "user_message" },
          { id: "assistant_messages", label: "Assistant messages", matches: (event) => event.kind === "assistant_message" },
          { id: "update_plan", label: "Plan updates", matches: isUpdatePlanEvent },
          { id: "plans", label: "Plans / updates", matches: (event) => event.kind === "proposed_plan" || isUpdatePlanEvent(event) },
          { id: "failed_commands", label: "Failed commands", matches: (event) => event.kind === "command" && event.status === "failed" },
          { id: "commands", label: "Commands", matches: (event) => event.kind === "command" },
          { id: "patch_applied", label: "Patch applied", matches: (event) => event.kind === "patch" && event.status === "success" },
          { id: "patch_failed", label: "Patch failed", matches: (event) => event.kind === "patch" && event.status === "failed" },
          { id: "patches", label: "All patches", matches: (event) => event.kind === "patch" },
          { id: "errors_warnings", label: "Errors / warnings", matches: (event) => event.severity !== "normal" || event.status === "failed" || ["error", "abort", "rollback", "compaction"].includes(event.kind) },
          { id: "mcp_calls", label: "MCP calls", matches: (event) => event.kind === "mcp_call" || String(event.toolName || "").startsWith("mcp__") },
          { id: "web_searches", label: "Web searches", matches: (event) => event.kind === "web_search" }
        ];
        function navigationCategoriesForEvent(event, events, categories = NAVIGATION_CATEGORIES) {
          return categories.map((category) => ({
            ...category,
            matchesInResult: events.filter((candidate) => category.matches(candidate))
          })).filter((category) => category.matches(event) && category.matchesInResult.length);
        }
        return {
          NAVIGATION_CATEGORIES,
          isUpdatePlanEvent,
          navigationCategoriesForEvent
        };
      });
    }
  });

  // src/browser/event-chips.js
  var require_event_chips = __commonJS({
    "src/browser/event-chips.js"(exports, module) {
      (function initEventChips(root, factory) {
        const api = factory();
        if (typeof module === "object" && module.exports) module.exports = api;
        root.sessionEventChips = api;
      })(typeof globalThis !== "undefined" ? globalThis : window, function createEventChipsApi() {
        "use strict";
        function meaningfulEventKind(event) {
          return event.kind === "protocol" ? "" : String(event.kind || "").trim();
        }
        function inspectorChipValues(event) {
          return [
            meaningfulEventKind(event),
            event.status,
            event.severity && event.severity !== "normal" ? event.severity : ""
          ];
        }
        function rawRefsSubtitle(event) {
          return String(event.label || meaningfulEventKind(event)).trim();
        }
        return {
          inspectorChipValues,
          rawRefsSubtitle
        };
      });
    }
  });

  // src/browser/app.js
  var require_app = __commonJS({
    "src/browser/app.js"() {
      "use strict";
      var rendererApi = window.sessionRenderers;
      var escapeHtml = rendererApi.escapeHtml;
      var renderSections = rendererApi.renderSections;
      var renderTimelineSections = rendererApi.renderTimelineSections;
      var searchQuery = window.sessionSearchQuery;
      var searchHighlighter = window.sessionSearchHighlighter;
      var foldingApi = window.sessionFolding;
      var i18n = window.sessionI18n;
      var navigationApi = window.sessionNavigation;
      var eventChipsApi = window.sessionEventChips;
      var NAVIGATION_PAGE_LIMIT = 500;
      var TIMELINE_AUTO_LOAD_SCROLL_THRESHOLD = 96;
      var SEARCH_TARGET_PRELOAD_MIN = 5;
      var SEARCH_TARGET_PRELOAD_MAX_PAGES = 3;
      var FILE_SUGGESTION_LIMIT = 12;
      var SEARCH_HIGHLIGHT_INPUT_DELAY_MS = 300;
      var REPO_STORAGE_KEY = "sessionAnalyzer.repoRoot";
      var CUSTOM_PROFILES_KEY = "sessionAnalyzer.customProfiles";
      var OVERRIDES_KEY = "sessionAnalyzer.overrides";
      var LOCALE_STORAGE_KEY = "sessionAnalyzer.locale";
      var DISPLAY_STATES = foldingApi.DISPLAY_STATES;
      var CONDITION_DISPLAY_STATES = foldingApi.CONDITION_DISPLAY_STATES;
      var EDITABLE_EVENT_KINDS = foldingApi.EDITABLE_EVENT_KINDS;
      var CONDITION_DEFINITIONS = foldingApi.CONDITION_DEFINITIONS;
      var normalizeRules = foldingApi.normalizeRules;
      var normalizeOverrides = foldingApi.normalizeOverrides;
      var evaluateDisplayStateFromRules = foldingApi.displayStateFromRules;
      var inspectorChipValues = eventChipsApi.inspectorChipValues;
      var rawRefsSubtitle = eventChipsApi.rawRefsSubtitle;
      var KIND_LABELS = {
        user_message: "User message",
        assistant_message: "Assistant message",
        command: "Command",
        patch: "Patch",
        mcp_call: "MCP call",
        js_repl: "JS REPL",
        other_tool_call: "Other tool call",
        proposed_plan: "Proposed plan",
        plan_update: "Plan update",
        protocol: "Protocol",
        error: "Error",
        warning: "Warning",
        abort: "Turn aborted",
        rollback: "Thread rollback",
        compaction: "Context compaction",
        usage_limit_warning: "Usage limit warning",
        subagent: "Subagent activity",
        review: "Review",
        reasoning: "Reasoning",
        web_search: "Web search",
        event: "Event"
      };
      var STATUS_LABELS = {
        failed: "Failed",
        success: "Success",
        completed: "Completed"
      };
      var LAYER_LABELS = {
        main: "Main timeline",
        protocol: "Protocol layer",
        raw: "Raw records"
      };
      var NAVIGATION_CATEGORIES = navigationApi.NAVIGATION_CATEGORIES;
      function browserLocale() {
        const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
        if (saved) return i18n.resolveLocale(saved);
        return i18n.resolveLocale(navigator.languages?.[0] || navigator.language || "");
      }
      function t(key, vars = {}) {
        return i18n.t(state?.locale || browserLocale(), "ui", key, vars);
      }
      function displayStateLabel(value) {
        return i18n.displayStateLabel(value, state?.locale || browserLocale());
      }
      function statusLabel(value) {
        return i18n.statusLabel(value, state?.locale || browserLocale());
      }
      var state = {
        locale: browserLocale(),
        sessions: [],
        repoRoot: "",
        projects: [],
        projectSelected: false,
        selectingProject: false,
        projectLoadingRoot: "",
        projectJobId: "",
        projectPollTimer: 0,
        projectChooserRequestId: 0,
        projectReturning: false,
        selectedSessionId: "",
        selectedEventId: "",
        offset: 0,
        limit: 150,
        timelineLoading: false,
        timelineRequestId: 0,
        sessionGrandTotal: 0,
        sessionTotal: 0,
        timelineTotal: 0,
        timelineSearchMatchCount: 0,
        currentEvents: [],
        fileSuggestions: [],
        eventKinds: { main: [], protocol: [], raw: [] },
        sessionEventKinds: { main: [], protocol: [], raw: [] },
        profiles: [],
        builtinProfiles: [],
        customProfiles: readJsonStorage(CUSTOM_PROFILES_KEY, []),
        profileId: localStorage.getItem("sessionAnalyzer.profile") || "narrative",
        previousProfileBeforeMetric: "",
        previousLayerBeforeProtocol: "",
        dirtyProfileDecisionPending: null,
        profileDraft: null,
        layerId: localStorage.getItem("sessionAnalyzer.layer") || "main",
        overrides: normalizeOverrides(readJsonStorage(OVERRIDES_KEY, {})),
        detailCache: {},
        detailErrors: {},
        detailPending: {},
        detailCacheGeneration: 0,
        detailViewportTimer: 0,
        detailView: { type: "profileRules" },
        detailHistory: [],
        detailSelectionKey: "",
        navigationCategoryId: "",
        navigationCategoryManualId: "",
        navigationCache: { key: "", events: [], total: 0, pending: null },
        searchHighlight: { query: "", marks: [], activeIndex: -1 },
        searchHighlightTimer: 0,
        searchTargetPreload: { key: "", pages: 0, pending: false },
        searchStructureKey: "",
        mobileView: "sessions"
      };
      var el = {
        topbar: document.querySelector(".topbar"),
        projectTitle: document.getElementById("projectTitle"),
        projectSwitchControl: document.getElementById("projectSwitchControl"),
        projectSwitchHint: document.querySelector(".projectSwitchHint"),
        stateLine: document.getElementById("stateLine"),
        searchInput: document.getElementById("searchInput"),
        localeSelect: document.getElementById("localeSelect"),
        searchAssist: document.getElementById("searchAssist"),
        searchAssistChips: document.getElementById("searchAssistChips"),
        searchField: document.querySelector(".searchField"),
        searchKindSelect: document.getElementById("searchKindSelect"),
        searchStatusSelect: document.getElementById("searchStatusSelect"),
        searchLayerSelect: document.getElementById("searchLayerSelect"),
        searchFileInput: document.getElementById("searchFileInput"),
        searchFileSuggestions: document.getElementById("searchFileSuggestions"),
        profileSelect: document.getElementById("profileSelect"),
        layerSelect: document.getElementById("layerSelect"),
        sortSelect: document.getElementById("sortSelect"),
        sessionList: document.getElementById("sessionList"),
        sessionHeader: document.getElementById("sessionHeader"),
        analysisPanel: document.getElementById("analysisPanel"),
        timeline: document.getElementById("timeline"),
        detail: document.getElementById("detail"),
        resetFoldsBtn: document.getElementById("resetFoldsBtn"),
        loadMoreBtn: document.getElementById("loadMoreBtn"),
        resultSummary: document.getElementById("resultSummary"),
        dirtyProfileDialog: document.getElementById("dirtyProfileDialog"),
        dirtyProfileCurrentName: document.getElementById("dirtyProfileCurrentName"),
        dirtyProfileSaveName: document.getElementById("dirtyProfileSaveName"),
        mobileViewButtons: document.querySelectorAll("[data-mobile-view]"),
        projectChooser: document.getElementById("projectChooser"),
        projectStatus: document.getElementById("projectStatus"),
        projectProgress: document.getElementById("projectProgress"),
        projectCancelBtn: document.getElementById("projectCancelBtn"),
        projectList: document.getElementById("projectList"),
        projectChooserTitle: document.querySelector(".projectChooserHeader h2"),
        projectChooserDescription: document.querySelector(".projectChooserHeader p")
      };
      var profileInfoSlot = null;
      function setMobileView(view, options = {}) {
        if (!["sessions", "events", "detail"].includes(view)) return;
        const changed = state.mobileView !== view;
        state.mobileView = view;
        document.body.dataset.mobileView = view;
        for (const button of el.mobileViewButtons) {
          const active = button.dataset.mobileView === view;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        }
        if (view === "events") queueVisibleDetailLoad();
        updateDetailViewChrome();
        if (changed && options.scroll !== false && window.matchMedia("(max-width: 760px)").matches) {
          window.scrollTo({ top: 0, behavior: "auto" });
        }
        syncProfileInfoSlot();
      }
      function updateDetailViewChrome() {
        document.body.dataset.detailView = state.detailView?.type || "profileRules";
      }
      function setText(node, text) {
        if (node) node.textContent = text;
      }
      function setSelectOptionText(select, value, text) {
        const option = select ? [...select.options].find((item) => item.value === value) : null;
        if (option) option.textContent = text;
      }
      function applyStaticLocale() {
        window.sessionAnalyzerLocale = state.locale;
        document.documentElement.lang = state.locale;
        if (el.localeSelect) el.localeSelect.value = state.locale;
        document.querySelector(".localeControl .srOnly") && setText(document.querySelector(".localeControl .srOnly"), t("localeLabel"));
        if (el.localeSelect) el.localeSelect.setAttribute("aria-label", t("localeLabel"));
        if (!state.repoRoot && !state.projectLoadingRoot) setText(el.stateLine, t("stateLoading"));
        if (el.searchInput) el.searchInput.placeholder = t("searchPlaceholder");
        if (el.searchAssist) el.searchAssist.setAttribute("aria-label", t("searchOptions"));
        document.querySelector("[data-search-match-controls]")?.setAttribute("title", t("searchMatchTitle"));
        document.querySelector('[data-search-match-nav="previous"]')?.setAttribute("aria-label", t("previousSearchMatch"));
        document.querySelector('[data-search-match-nav="previous"]')?.setAttribute("title", t("previousSearchMatch"));
        document.querySelector('[data-search-match-nav="next"]')?.setAttribute("aria-label", t("nextSearchMatch"));
        document.querySelector('[data-search-match-nav="next"]')?.setAttribute("title", t("nextSearchMatch"));
        document.querySelectorAll(".searchAssistTitle")[0] && setText(document.querySelectorAll(".searchAssistTitle")[0], t("searchFilters"));
        document.querySelectorAll(".searchAssistTitle")[1] && setText(document.querySelectorAll(".searchAssistTitle")[1], t("active"));
        setSelectOptionText(el.searchKindSelect, "", t("anyKind"));
        setSelectOptionText(el.searchStatusSelect, "", t("anyStatus"));
        setSelectOptionText(el.searchStatusSelect, "failed", statusLabel("failed"));
        setSelectOptionText(el.searchStatusSelect, "success", statusLabel("success"));
        setSelectOptionText(el.searchStatusSelect, "completed", statusLabel("completed"));
        setSelectOptionText(el.searchLayerSelect, "", t("currentLayer"));
        setSelectOptionText(el.searchLayerSelect, "main", t("mainTimeline"));
        setSelectOptionText(el.searchLayerSelect, "protocol", t("protocolLayer"));
        setSelectOptionText(el.searchLayerSelect, "raw", t("rawRecords"));
        setSelectOptionText(el.layerSelect, "main", t("mainTimeline"));
        setSelectOptionText(el.layerSelect, "protocol", t("protocolLayer"));
        setSelectOptionText(el.layerSelect, "raw", t("rawRecords"));
        setSelectOptionText(el.sortSelect, "updated-desc", t("updatedDesc"));
        setSelectOptionText(el.sortSelect, "started-asc", t("startedAsc"));
        setSelectOptionText(el.sortSelect, "events-desc", t("eventsDesc"));
        setSelectOptionText(el.sortSelect, "failures-desc", t("failuresDesc"));
        setText(document.querySelector('.mobileViewTab[data-mobile-view="sessions"]'), t("sessions"));
        setText(document.querySelector('.mobileViewTab[data-mobile-view="events"]'), t("events"));
        setText(document.querySelector('.mobileViewTab[data-mobile-view="detail"]'), t("detail"));
        setText(el.resetFoldsBtn, t("resetFolds"));
        setText(el.loadMoreBtn, t("loadMore"));
        setText(document.querySelector(".projectChooserHeader h2"), t("selectProject"));
        setText(document.querySelector(".projectChooserHeader p"), t("chooseProject"));
        setText(el.projectCancelBtn, t("cancelIndexing"));
        setText(document.querySelector(".sessionsPane .sessionListHeader h2"), t("sessions"));
        setText(document.querySelector(".sortControl .srOnly"), t("sort"));
        el.layerSelect?.setAttribute("aria-label", t("layer"));
        el.profileSelect?.setAttribute("aria-label", t("foldingStrategy"));
        setText(document.getElementById("dirtyProfileTitle"), t("dirtyProfileTitle"));
        setText(document.getElementById("dirtyProfileMessage"), t("dirtyProfileMessage"));
        setText(document.querySelector(".appDialogMeta dt"), t("currentStrategy"));
        setText(document.querySelector(".appDialogField span"), t("saveAs"));
        setText(document.querySelector('[data-dirty-profile-choice="save"]'), t("saveAndSwitch"));
        setText(document.querySelector('[data-dirty-profile-choice="discard"]'), t("discardAndSwitch"));
        setText(document.querySelector('[data-dirty-profile-choice="cancel"]'), t("cancel"));
        const sessionHeaderTitle = el.sessionHeader?.querySelector("h2");
        const sessionHeaderText = el.sessionHeader?.querySelector("p");
        if (!state.selectedSessionId) {
          setText(sessionHeaderTitle, t("chooseSession"));
          setText(sessionHeaderText, t("leftListFiltered"));
        }
        if (!state.selectedEventId && !el.detail?.querySelector(".detailView")) {
          const detailTitle = el.detail?.querySelector("h2");
          const detailText = el.detail?.querySelector("p");
          setText(detailTitle, t("eventDetail"));
          setText(detailText, t("clickTimelineEvent"));
        }
        updateProjectChooserHeader();
        updateProjectSwitchControl();
      }
      function readJsonStorage(key, fallback) {
        try {
          const value = JSON.parse(localStorage.getItem(key) || "null");
          return value == null ? fallback : value;
        } catch {
          return fallback;
        }
      }
      function writeJsonStorage(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
      }
      function api(path, options = {}) {
        const init2 = { ...options };
        let requestPath = path;
        const method = String(init2.method || "GET").toUpperCase();
        if (method === "GET") {
          const url = new URL(path, window.location.origin);
          url.searchParams.set("locale", state.locale);
          requestPath = `${url.pathname}${url.search}${url.hash}`;
        }
        if (options.body && typeof options.body !== "string") {
          init2.body = JSON.stringify(options.body);
          init2.headers = { "content-type": "application/json", ...options.headers || {} };
        }
        return fetch(requestPath, init2).then(async (res) => {
          const body = await res.json();
          if (!res.ok) {
            const error = new Error(body.error || `HTTP ${res.status}`);
            error.status = res.status;
            error.details = body.details;
            throw error;
          }
          return body;
        });
      }
      function debounce(fn, ms) {
        let timer = 0;
        const debounced = (...args) => {
          clearTimeout(timer);
          timer = setTimeout(() => fn(...args), ms);
        };
        debounced.cancel = () => {
          clearTimeout(timer);
          timer = 0;
        };
        return debounced;
      }
      function fmtDate(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString();
      }
      function projectName(repoRoot) {
        const text = String(repoRoot || "").replace(/[\\/]+$/, "");
        if (!text) return t("selectProject");
        return text.split(/[\\/]/).filter(Boolean).pop() || text;
      }
      function setProjectHeader(repoRoot, summary) {
        updateProjectSwitchControl({ displayRoot: repoRoot, returnRoot: state.repoRoot });
        el.stateLine.textContent = summary || "";
      }
      function updateProjectChrome(options = {}) {
        if (el.topbar) el.topbar.hidden = Boolean(state.projectLoadingRoot);
        updateProjectChooserHeader();
        updateProjectSwitchControl(options);
      }
      function updateProjectChooserHeader() {
        if (!el.projectChooserTitle || !el.projectChooserDescription) return;
        if (state.projectLoadingRoot) {
          el.projectChooserTitle.textContent = t("openingProject", { name: projectName(state.projectLoadingRoot) });
          el.projectChooserDescription.textContent = t("indexingProject");
        } else {
          el.projectChooserTitle.textContent = t("selectProject");
          el.projectChooserDescription.textContent = t("chooseProject");
        }
      }
      function updateProjectSwitchControl(options = {}) {
        const displayRoot = Object.hasOwn(options, "displayRoot") ? options.displayRoot : state.repoRoot;
        const returnRoot = Object.hasOwn(options, "returnRoot") ? options.returnRoot : state.repoRoot;
        const canReturn = state.selectingProject && Boolean(returnRoot);
        const labelRoot = canReturn ? returnRoot : displayRoot;
        if (el.projectTitle) el.projectTitle.textContent = projectName(labelRoot);
        if (el.projectSwitchHint) {
          el.projectSwitchHint.textContent = state.projectReturning ? t("returning") : canReturn ? t("return") : displayRoot ? t("change") : t("select");
        }
        if (!el.projectSwitchControl) return;
        el.projectSwitchControl.disabled = state.projectReturning || Boolean(state.projectLoadingRoot || state.projectJobId);
        if (state.projectReturning && returnRoot) {
          el.projectSwitchControl.title = t("returningToProject", { root: returnRoot });
          el.projectSwitchControl.setAttribute("aria-label", t("returningToCurrentProject", { root: returnRoot }));
        } else if (canReturn) {
          el.projectSwitchControl.title = t("returnToProject", { root: returnRoot });
          el.projectSwitchControl.setAttribute("aria-label", t("returnToCurrentProject", { root: returnRoot }));
        } else {
          el.projectSwitchControl.title = displayRoot ? t("switchProject", { root: displayRoot }) : t("selectProject");
          el.projectSwitchControl.setAttribute("aria-label", displayRoot ? t("switchTargetProject", { root: displayRoot }) : t("selectProject"));
        }
      }
      function fmtBytes(bytes) {
        if (!bytes) return "0 B";
        const units = ["B", "KB", "MB", "GB"];
        let n = bytes;
        let i = 0;
        while (n > 1024 && i < units.length - 1) {
          n /= 1024;
          i += 1;
        }
        return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
      }
      function fmtDuration(ms) {
        const n = Number(ms || 0);
        if (!Number.isFinite(n) || n <= 0) return "0s";
        if (n < 1e3) return `${Math.round(n)}ms`;
        return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}s`;
      }
      function humanizeKind(value) {
        const text = String(value || "").trim();
        if (!text) return "";
        if (/^mcp\b/i.test(text)) return text.replace(/_/g, " ").replace(/^mcp/i, "MCP");
        return text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/\bJs\b/g, "JS");
      }
      function kindLabel(value) {
        return i18n.eventKindLabel(value, state.locale) || KIND_LABELS[value] || humanizeKind(value) || value;
      }
      function projectProgressPercent(progress) {
        const phase = progress?.phase || "";
        if (phase === "complete") return 100;
        if (phase === "parsing") {
          const total2 = Number(progress.candidateFileCount || 0);
          const done2 = Number(progress.indexedFileCount || 0);
          return total2 ? Math.max(5, Math.min(99, Math.round(done2 / total2 * 100))) : 5;
        }
        const total = Number(progress?.filesTotal || 0);
        const done = Number(progress?.filesScanned || 0);
        return total ? Math.max(1, Math.min(95, Math.round(done / total * 100))) : 0;
      }
      function renderProjectJob(job) {
        const progress = job?.progress || {};
        const phase = progress.phase || job?.status || "queued";
        const parts = [];
        if (phase === "selecting") {
          parts.push(t("scanningFiles", { done: progress.filesScanned || 0, total: progress.filesTotal || 0 }));
          parts.push(t("candidates", { count: progress.candidateFileCount || 0 }));
          parts.push(t("skipped", { count: progress.skippedFileCount || 0 }));
        } else if (phase === "parsing") {
          parts.push(t("parsingFiles", { done: progress.indexedFileCount || 0, total: progress.candidateFileCount || 0 }));
          parts.push(t("sessionCount", { count: progress.sessionCount || 0 }));
          parts.push(fmtBytes(progress.indexedBytes || 0));
        } else if (job?.status === "cancelled") {
          parts.push(t("indexingCancelled"));
        } else if (job?.status === "failed") {
          parts.push(job.error || t("indexingFailed"));
        } else {
          parts.push(t("preparingIndex", { name: projectName(job?.repoRoot || progress.repoRoot || "") }));
        }
        if (progress.elapsedMs || job?.buildMs) parts.push(fmtDuration(progress.elapsedMs || job.buildMs));
        if (el.projectStatus) el.projectStatus.textContent = parts.join(" | ");
        if (el.projectProgress) {
          el.projectProgress.hidden = !job || ["failed", "cancelled"].includes(job.status);
          el.projectProgress.value = projectProgressPercent(progress);
        }
        if (el.projectCancelBtn) {
          el.projectCancelBtn.hidden = !job || !["queued", "running"].includes(job.status);
        }
      }
      function parsedSearchInput() {
        return searchQuery.parseSearchInput(el.searchInput.value);
      }
      function currentSearchState() {
        const parsed = parsedSearchInput();
        return {
          q: parsed.q,
          file: parsed.file,
          kind: parsed.kind,
          status: parsed.status,
          layer: parsed.layer || state.layerId || "main",
          parsed
        };
      }
      function activeLayerId() {
        return currentSearchState().layer || "main";
      }
      function profileAppliesToActiveLayer() {
        return activeLayerId() === "main";
      }
      function activeLayerLabel() {
        const layer = activeLayerId();
        if (layer === "main") return t("mainTimeline");
        if (layer === "protocol") return t("protocolLayer");
        if (layer === "raw") return t("rawRecords");
        return LAYER_LABELS[layer] || layer;
      }
      function highlightTerms() {
        return searchHighlighter.searchTerms(currentSearchState().q);
      }
      function highlightRoots() {
        return [el.sessionList, el.timeline, el.detail].filter(Boolean);
      }
      function searchTargetPreloadKey() {
        const search = currentSearchState();
        return [
          state.selectedSessionId,
          search.layer,
          search.q,
          search.kind,
          search.status,
          search.file
        ].join("");
      }
      function structuredSearchKey() {
        const search = currentSearchState();
        return searchQuery.structuredSearchKey(
          { kind: search.kind, status: search.status, file: search.file, layer: search.parsed.layer || "" },
          state.layerId || "",
          el.sortSelect?.value || ""
        );
      }
      function currentSearchMarkLabel() {
        const { marks, activeIndex } = state.searchHighlight;
        const total = searchHighlighter.displayedMatchTotal(state.timelineSearchMatchCount, marks.length);
        if (!total) return t("noMatches");
        const current = marks.length && activeIndex >= 0 ? activeIndex + 1 : 0;
        return t("matchCount", { current, total });
      }
      function updateSearchMatchControls() {
        const controls = document.querySelectorAll("[data-search-match-controls]");
        const { marks } = state.searchHighlight;
        const visible = Boolean(currentSearchState().q);
        controls.forEach((control) => {
          control.hidden = !visible;
          const label = control.querySelector("[data-search-match-count]");
          if (label) label.textContent = currentSearchMarkLabel();
          control.querySelectorAll("[data-search-match-nav]").forEach((button) => {
            button.disabled = marks.length === 0;
          });
        });
      }
      function maybePreloadSearchTargets() {
        const search = currentSearchState();
        if (!search.q || !state.selectedSessionId) return;
        if (state.searchHighlight.marks.length >= SEARCH_TARGET_PRELOAD_MIN) return;
        if (state.offset >= state.timelineTotal) return;
        if (state.timelineLoading || state.searchTargetPreload.pending) return;
        const key = searchTargetPreloadKey();
        if (state.searchTargetPreload.key !== key) {
          state.searchTargetPreload = { key, pages: 0, pending: false };
        }
        if (state.searchTargetPreload.pages >= SEARCH_TARGET_PRELOAD_MAX_PAGES) return;
        state.searchTargetPreload.pages += 1;
        state.searchTargetPreload.pending = true;
        loadTimeline(true).catch(showError).finally(() => {
          state.searchTargetPreload.pending = false;
          if (state.searchHighlight.marks.length < SEARCH_TARGET_PRELOAD_MIN) {
            maybePreloadSearchTargets();
          }
        });
      }
      function setActiveSearchMark(index, options = {}) {
        const marks = state.searchHighlight.marks;
        marks.forEach((mark2) => mark2.classList.remove("activeSearchMark"));
        if (!marks.length) {
          state.searchHighlight.activeIndex = -1;
          updateSearchMatchControls();
          return false;
        }
        const normalized = (index % marks.length + marks.length) % marks.length;
        state.searchHighlight.activeIndex = normalized;
        const mark = marks[normalized];
        mark.classList.add("activeSearchMark");
        if (options.scroll || options.syncDetail) {
          const article = mark.closest("[data-event-id]");
          if (article?.dataset.eventId) {
            state.selectedEventId = article.dataset.eventId;
            updateSelectedTimelineEvent();
            if (options.syncDetail) {
              const item = state.currentEvents.find((event) => event.id === article.dataset.eventId);
              if (item) {
                showInspector(item, { replace: true });
              }
            }
          }
        }
        if (options.scroll) {
          const liveMark = state.searchHighlight.marks[state.searchHighlight.activeIndex];
          searchHighlighter.reveal(liveMark);
        }
        updateSearchMatchControls();
        return true;
      }
      function refreshSearchHighlights(options = {}) {
        const roots = highlightRoots();
        const previousQuery = state.searchHighlight.query;
        const previousIndex = state.searchHighlight.activeIndex;
        roots.forEach((root) => searchHighlighter.clear(root));
        const query = currentSearchState().q;
        const terms = highlightTerms();
        const marks = terms.length ? roots.flatMap((root) => searchHighlighter.apply(root, terms)) : [];
        state.searchHighlight = {
          query,
          marks,
          activeIndex: -1
        };
        if (marks.length) {
          const keepIndex = options.preserveActive && query === previousQuery && previousIndex >= 0;
          setActiveSearchMark(keepIndex ? Math.min(previousIndex, marks.length - 1) : 0, {
            scroll: false,
            syncDetail: options.syncDetail
          });
        } else {
          updateSearchMatchControls();
        }
        if (options.allowPreload !== false) maybePreloadSearchTargets();
      }
      function navigateSearchMatch(direction) {
        if (!state.searchHighlight.marks.length) refreshSearchHighlights({ preserveActive: true, syncDetail: true });
        const marks = state.searchHighlight.marks;
        if (!marks.length) return false;
        const current = state.searchHighlight.activeIndex >= 0 ? state.searchHighlight.activeIndex : 0;
        return setActiveSearchMark(current + direction, { scroll: true, syncDetail: true });
      }
      function scheduleSearchHighlightRefresh(options = {}) {
        if (state.searchHighlightTimer) clearTimeout(state.searchHighlightTimer);
        state.searchHighlightTimer = setTimeout(() => {
          state.searchHighlightTimer = 0;
          refreshSearchHighlights(options);
          renderResultSummary();
        }, SEARCH_HIGHLIGHT_INPUT_DELAY_MS);
      }
      function currentQuery(extra = {}, options = {}) {
        const params = new URLSearchParams();
        const filters = currentSearchState();
        if (options.includeQ !== false && filters.q) params.set("q", filters.q);
        if (filters.kind) params.set("kind", filters.kind);
        if (filters.status) params.set("status", filters.status);
        if (filters.file) params.set("file", filters.file);
        if (filters.layer) params.set("layer", filters.layer);
        for (const [key, value] of Object.entries(extra)) {
          if (value !== "" && value != null) params.set(key, value);
        }
        const text = params.toString();
        return text ? `?${text}` : "";
      }
      function detailKey(sessionId, layerId, eventId) {
        return `${sessionId}:${layerId}:${eventId}`;
      }
      function resetDetailPane() {
        state.detailSelectionKey = "";
        state.selectedEventId = "";
        state.navigationCategoryId = "";
        state.navigationCategoryManualId = "";
        state.detailHistory = [];
        state.searchTargetPreload = { key: "", pages: 0, pending: false };
        state.detailView = { type: "profileRules" };
        renderProfileRulesPane({ reveal: false });
        updateSelectedTimelineEvent();
      }
      function cloneProfile(profile) {
        return JSON.parse(JSON.stringify(profile || {}));
      }
      function defaultRules() {
        return { kindStates: {}, fallback: "summary", conditions: [] };
      }
      function normalizeProfiles(profiles) {
        return (Array.isArray(profiles) ? profiles : []).map((profile) => ({
          ...profile,
          rules: normalizeRules(profile.rules || defaultRules())
        }));
      }
      function activeProfile() {
        return state.profiles.find((profile) => profile.id === state.profileId) || state.profiles.find((profile) => profile.id === "narrative") || state.profiles[0] || i18n.localizeProfile({ id: "narrative", name: "narrative", description: "", rules: defaultRules() }, state.locale);
      }
      function renderProfileOptions() {
        return state.profiles.map((profile) => `<option value="${escapeHtml(profile.id)}" title="${escapeHtml(profile.description || "")}">${escapeHtml(profile.name || profile.id)}</option>`).join("");
      }
      function renderProfileInfoItems() {
        const rows = state.profiles.map((profile) => {
          const active = profile.id === state.profileId ? " active" : "";
          const description = profile.description || t("profileInfoMissingDescription");
          return `<div class="profileInfoItem${active}">
      <strong>${escapeHtml(profile.name || profile.id)}</strong>
      <p>${escapeHtml(description)}</p>
    </div>`;
        }).join("");
        return rows || `<div class="profileInfoItem"><p>${escapeHtml(t("profileInfoEmpty"))}</p></div>`;
      }
      function profileInfoLabel() {
        const profile = activeProfile();
        const description = profile.description || t("profileInfoMissingDescription");
        return t("profileInfoLabel", { name: profile.name || profile.id, description });
      }
      function ensureProfileInfoSlot() {
        if (profileInfoSlot) return profileInfoSlot;
        profileInfoSlot = document.createElement("span");
        profileInfoSlot.className = "profileInfoSlot";
        profileInfoSlot.innerHTML = '<button class="profileInfoBtn" type="button">\u24D8</button><div id="profileInfoPopover" class="profileInfoPopover" role="tooltip"></div>';
        return profileInfoSlot;
      }
      function elementVisible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
      }
      function visibleProfilePickerHost(host) {
        if (!host || !elementVisible(host)) return null;
        const select = host.querySelector("select");
        return elementVisible(select) ? host : null;
      }
      function syncProfileInfoSlot(analyzerDisabled = false) {
        const detailHost = el.detail?.querySelector('[data-profile-picker-host="detail"]');
        const topbarHost = el.profileSelect?.closest('[data-profile-picker-host="topbar"]');
        const host = !analyzerDisabled && profileAppliesToActiveLayer() && isBuiltinProfile(state.profileId) && !profileDirty() ? visibleProfilePickerHost(detailHost) || visibleProfilePickerHost(topbarHost) : null;
        const slot = ensureProfileInfoSlot();
        const previousHost = slot.closest("[data-profile-picker-host]");
        if (previousHost && previousHost !== host) previousHost.classList.remove("hasProfileInfo");
        if (!host) {
          if (previousHost) previousHost.classList.remove("hasProfileInfo");
          slot.remove();
          return;
        }
        host.appendChild(slot);
        host.classList.add("hasProfileInfo");
        const button = slot.querySelector(".profileInfoBtn");
        const popover = slot.querySelector(".profileInfoPopover");
        button.disabled = false;
        button.setAttribute("aria-label", profileInfoLabel());
        button.setAttribute("aria-describedby", popover.id);
        popover.innerHTML = renderProfileInfoItems();
      }
      function activeProfileRules() {
        return state.profileDraft?.rules || activeProfile().rules || defaultRules();
      }
      function resetProfileDraft() {
        state.profileDraft = cloneProfile(activeProfile());
      }
      function isBuiltinProfile(profileId) {
        return state.builtinProfiles.some((profile) => profile.id === profileId);
      }
      function profileDirty() {
        const base = activeProfile();
        return JSON.stringify(state.profileDraft?.rules || {}) !== JSON.stringify(base.rules || {});
      }
      function saveCustomProfiles() {
        state.customProfiles = normalizeProfiles(state.customProfiles);
        writeJsonStorage(CUSTOM_PROFILES_KEY, state.customProfiles);
        state.profiles = normalizeProfiles([...state.builtinProfiles, ...state.customProfiles]);
      }
      function knownEventKinds() {
        const kinds = new Set(EDITABLE_EVENT_KINDS);
        for (const profile of state.profiles) {
          for (const kind of Object.keys(profile.rules?.kindStates || {})) kinds.add(kind);
        }
        for (const event of state.currentEvents) {
          if (event.kind) kinds.add(event.kind);
        }
        return [...kinds].sort((a, b) => kindLabel(a).localeCompare(kindLabel(b)) || a.localeCompare(b));
      }
      function conditionDefinitions() {
        return CONDITION_DEFINITIONS.map((condition) => i18n.localizeCondition(condition, state.locale));
      }
      function sourceRefs(event) {
        const refs = event.rawRefs?.length ? event.rawRefs : [event.source];
        return refs.filter((ref) => ref && ref.file && ref.line != null);
      }
      function sourceLabel(ref) {
        return ref && ref.file && ref.line != null ? `${ref.file}:${ref.line}` : "";
      }
      function renderChips(values) {
        return values.filter(Boolean).map((value) => `<span class="chip">${escapeHtml(value)}</span>`).join("");
      }
      function formatList(values, limit = 6) {
        const items = (values || []).filter(Boolean);
        if (!items.length) return "";
        const visible = items.slice(0, limit).join(", ");
        return items.length > limit ? `${visible}, +${items.length - limit} more` : visible;
      }
      function shortId(value) {
        return String(value || "").slice(0, 8);
      }
      function shortSessionTitle(value, limit = 54) {
        const text = String(value || "").replace(/\s+/g, " ").trim();
        if (!text || text.length <= limit) return text;
        return `${text.slice(0, limit - 1).trimEnd()}\u2026`;
      }
      function sessionRelationshipLabel(session) {
        if (session.isDerivedSession) {
          const parent = shortId(session.parentSessionId);
          const kind = session.derivedKind === "review" ? t("reviewKind") : t("subagentKind");
          const nickname = session.agentNickname && session.agentNickname.toLowerCase() !== kind.toLowerCase() ? ` ${session.agentNickname}` : "";
          const parentLabel = shortSessionTitle(session.parentSessionTitle) || parent;
          if (parentLabel) return t("derivedFrom", { kind, nickname, parent: parentLabel });
          return t("derivedSession", { kind, nickname });
        }
        const forkedFrom = shortId(session.forkedFromSessionId);
        const forkedFromLabel = shortSessionTitle(session.forkedFromSessionTitle) || forkedFrom;
        if (forkedFromLabel) return t("forkFrom", { parent: forkedFromLabel });
        return "";
      }
      function sessionRelationshipTitle(session, fallback = "") {
        if (session.isDerivedSession) return session.parentSessionTitle || session.parentSessionId || fallback;
        return session.forkedFromSessionTitle || session.forkedFromSessionId || fallback;
      }
      function sessionItemClasses(session, active) {
        const classes = ["sessionItem"];
        if (session.isDerivedSession) {
          classes.push("secondarySession");
          classes.push(session.derivedKind === "review" ? "derived-review" : "derived-subagent");
        }
        if (active) classes.push("active");
        return classes.join(" ");
      }
      function setRelatedParentHighlight(parentSessionId, enabled) {
        if (!parentSessionId) return;
        const parent = el.sessionList.querySelector(`[data-session-id="${CSS.escape(parentSessionId)}"]`);
        if (!parent) return;
        parent.classList.toggle("relatedParentSession", enabled);
      }
      function isUpdatePlanEvent(event) {
        return foldingApi.isUpdatePlanEvent(event);
      }
      function metadataRow(label, value) {
        if (value == null || value === "") return "";
        return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
      }
      function renderInspectorMetadata(event, refs, detail = null) {
        const meta = detail?.meta || event;
        const outputStats = meta.outputStats || event.outputStats || {};
        return [
          metadataRow(t("time"), fmtDate(meta.timestamp || event.timestamp)),
          metadataRow(t("status"), meta.status || event.status),
          metadataRow(t("severity"), meta.severity && meta.severity !== "normal" ? meta.severity : ""),
          metadataRow(t("tool"), meta.toolName || event.toolName),
          metadataRow(t("exitCode"), outputStats.exitCode == null ? "" : String(outputStats.exitCode)),
          metadataRow(t("duration"), outputStats.durationMs == null ? "" : `${outputStats.durationMs} ms`),
          metadataRow(t("recordType"), event.recordType),
          metadataRow(t("channels"), formatList(meta.channels || event.channels)),
          metadataRow(t("touchedFiles"), formatList(meta.touchedFiles || event.touchedFiles))
        ].join("");
      }
      function renderInspectorSource(event, refs, detail = null) {
        const meta = detail?.meta || event;
        const source = sourceLabel(meta.source || event.source || refs[0]);
        return `<section class="inspectorSection">
    <h3>${escapeHtml(t("source"))}</h3>
    ${source ? `<div class="inspectorSourcePath">${escapeHtml(source)}</div>` : ""}
    <div class="inspectorActions">
      <button class="smallBtn" type="button" data-detail-action="raw">${escapeHtml(t("rawRefs"))}</button>
      <span class="rawMeta">${escapeHtml(refs.length ? t("rawRows", { count: refs.length, plural: refs.length === 1 ? "" : "s" }) : t("noRawRefs"))}</span>
    </div>
  </section>`;
      }
      function renderInspectorDetail(event) {
        const key = detailKey(state.selectedSessionId, activeLayerId(), event.id);
        const detail = state.detailCache[key];
        const error = state.detailErrors[key];
        if (detail) {
          if (!detail.inspectorSections?.length) return "";
          return `<section class="inspectorSection">
      <h3>${escapeHtml(t("details"))}</h3>
      <div class="inspectorDetailBody">${renderSections(detail.inspectorSections)}</div>
    </section>`;
        }
        if (error) {
          return `<section class="inspectorSection">
      <h3>${escapeHtml(t("details"))}</h3>
      <div class="notice error"><p>${escapeHtml(error)}</p></div>
      <button class="smallBtn" type="button" data-detail-action="retry-detail">${escapeHtml(t("retryDetail"))}</button>
    </section>`;
        }
        return `<section class="inspectorSection">
    <h3>${escapeHtml(t("details"))}</h3>
    <div class="notice info"><p>${escapeHtml(t("loadingStructuredDetail"))}</p></div>
  </section>`;
      }
      function shouldShowInspectorSummary(event, preview, detail = null) {
        const source = String(preview || "").trim();
        if (!source) return false;
        if (source === String(event.label || "").trim()) return false;
        if (event.layer === "raw") return true;
        const bodyOwnedKinds = /* @__PURE__ */ new Set([
          "user_message",
          "assistant_message",
          "proposed_plan",
          "plan_update",
          "reasoning",
          "command",
          "patch",
          "js_repl"
        ]);
        if (bodyOwnedKinds.has(event.kind)) return false;
        if (detail?.timelineSections?.some((section) => ["markdown", "code", "terminal", "patch", "diff", "user_input", "plan_update", "collaboration"].includes(section.type))) return false;
        return true;
      }
      function optionText(select, value, fallback = {}) {
        const option = [...select.options].find((item) => item.value === value);
        return fallback[value] || option?.textContent?.trim() || value;
      }
      function activeFilters() {
        const filters = [];
        const search = currentSearchState();
        if (search.kind) filters.push({ key: "kind", label: `${t("kind")}: ${optionText(el.searchKindSelect, search.kind) || kindLabel(search.kind)}` });
        if (search.status) filters.push({ key: "status", label: `${t("status")}: ${optionText(el.searchStatusSelect, search.status, STATUS_LABELS)}` });
        if (search.file) filters.push({ key: "file", label: `${t("file")}: ${search.file}` });
        if (search.parsed.layer && search.layer !== "main") filters.push({ key: "layer", label: `${t("layer")}: ${optionText(el.layerSelect, search.layer, LAYER_LABELS)}` });
        return filters;
      }
      function activeFindAndFilters() {
        const search = currentSearchState();
        return [
          search.q ? { key: "q", label: `${t("find")}: ${search.q}` } : null,
          ...activeFilters()
        ].filter(Boolean);
      }
      function filterChipMarkup(filter) {
        return `<button class="filterChip" type="button" data-clear-filter="${escapeHtml(filter.key)}" aria-label="${escapeHtml(t("clear", { label: filter.label }))}">
      <span>${escapeHtml(filter.label)}</span><span aria-hidden="true">&times;</span>
    </button>`;
      }
      function renderFilterChips(filters) {
        return filters.map(filterChipMarkup).join("");
      }
      function hasFocusedTimelineContext() {
        const search = currentSearchState();
        return Boolean(search.kind || search.status || search.file || search.parsed.layer || activeLayerId() !== "main");
      }
      function renderReadFromHereAction() {
        if (!state.selectedSessionId || !state.selectedEventId || !hasFocusedTimelineContext()) return "";
        return `<button class="smallBtn readFromHereBtn" type="button" data-detail-action="read-from-here" title="${escapeHtml(t("readFromHereTitle"))}">${escapeHtml(t("readFromHere"))}</button>`;
      }
      function renderSearchAssistChips(filters = activeFindAndFilters()) {
        if (!el.searchAssistChips) return;
        if (!filters.length) {
          el.searchAssistChips.innerHTML = `<span class="searchAssistEmpty">${escapeHtml(t("noActiveFilters"))}</span>`;
          return;
        }
        el.searchAssistChips.innerHTML = `${renderFilterChips(filters)}<button class="clearFiltersBtn" type="button" data-clear-filter="all">${escapeHtml(t("clearAll"))}</button>`;
      }
      function setSelectIfOption(select, value) {
        if (!select) return;
        const hasOption = [...select.options].some((option) => option.value === value);
        select.value = hasOption ? value : "";
      }
      function normalizedKindOptions(layerId = activeLayerId()) {
        const seen = /* @__PURE__ */ new Set();
        const options = [];
        const source = state.selectedSessionId ? state.sessionEventKinds : state.eventKinds;
        for (const item of source?.[layerId] || []) {
          const value = String(item?.value || "").trim();
          if (!value || seen.has(value)) continue;
          seen.add(value);
          options.push({
            value,
            label: item.label || kindLabel(value),
            count: Number(item.count || 0)
          });
        }
        return options.sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
      }
      function renderKindOptions() {
        if (!el.searchKindSelect) return;
        const search = currentSearchState();
        const options = normalizedKindOptions(search.layer);
        const values = new Set(options.map((option) => option.value));
        const rows = [`<option value="">${escapeHtml(t("anyKind"))}</option>`];
        if (search.kind && !values.has(search.kind)) {
          rows.push(`<option value="${escapeHtml(search.kind)}">${escapeHtml(`${kindLabel(search.kind)} (${search.kind})`)}</option>`);
        }
        rows.push(...options.map((option) => {
          const label = option.count ? `${option.label} (${option.count})` : option.label;
          return `<option value="${escapeHtml(option.value)}">${escapeHtml(label)}</option>`;
        }));
        el.searchKindSelect.innerHTML = rows.join("");
        el.searchKindSelect.value = search.kind;
      }
      function syncSearchAssistControls() {
        const search = currentSearchState();
        renderKindOptions();
        setSelectIfOption(el.searchKindSelect, search.kind);
        setSelectIfOption(el.searchStatusSelect, search.status);
        setSelectIfOption(el.searchLayerSelect, search.parsed.layer);
        if (el.searchFileInput) el.searchFileInput.value = search.file;
      }
      function showSearchAssist() {
        if (!el.searchAssist) return;
        el.searchAssist.hidden = false;
        el.searchInput.setAttribute("aria-expanded", "true");
        syncSearchAssistControls();
        renderSearchAssistChips();
      }
      function hideSearchAssist() {
        if (!el.searchAssist) return;
        el.searchAssist.hidden = true;
        el.searchInput.setAttribute("aria-expanded", "false");
      }
      function focusSearchEnd() {
        el.searchInput.focus();
        const end = el.searchInput.value.length;
        el.searchInput.setSelectionRange(end, end);
      }
      function applySearchOperator(operator, value) {
        if (!operator) return;
        if (value) {
          el.searchInput.value = searchQuery.upsertOperator(el.searchInput.value, operator, value);
        } else {
          el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, operator);
        }
        syncSearchAssistControls();
        renderSearchAssistChips();
        updateProfileApplicabilityUi();
        focusSearchEnd();
        loadSessions().catch(showError);
      }
      function normalizeFileSuggestionText(value) {
        return String(value || "").trim().replace(/\\/g, "/").toLowerCase();
      }
      function visibleFileSuggestions() {
        const text = normalizeFileSuggestionText(el.searchFileInput?.value);
        const suggestions = text ? state.fileSuggestions.filter((item) => normalizeFileSuggestionText(item.file).includes(text)) : state.fileSuggestions;
        return suggestions.slice(0, FILE_SUGGESTION_LIMIT);
      }
      function setFileSuggestionsOpen(open) {
        if (!el.searchFileSuggestions || !el.searchFileInput) return;
        const suggestions = visibleFileSuggestions();
        const shouldOpen = open && suggestions.length > 0;
        el.searchFileSuggestions.hidden = !shouldOpen;
        el.searchFileInput.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
      }
      function hideFileSuggestions() {
        setFileSuggestionsOpen(false);
      }
      function renderFileSuggestions() {
        if (!el.searchFileSuggestions) return;
        const suggestions = visibleFileSuggestions();
        el.searchFileSuggestions.innerHTML = suggestions.map((item) => `<button class="fileSuggestion" type="button" role="option" data-search-file-suggestion="${escapeHtml(item.file)}">
      <span class="fileSuggestionPath">${escapeHtml(item.file)}</span>
      <span class="fileSuggestionHits">${escapeHtml(item.count)} hits</span>
    </button>`).join("");
        setFileSuggestionsOpen(document.activeElement === el.searchFileInput);
      }
      function isSuggestedFile(value) {
        const text = String(value || "").trim();
        return !!text && state.fileSuggestions.some((item) => item.file === text);
      }
      function renderResultSummary() {
        if (!el.resultSummary) return;
        const filters = activeFilters();
        const controls = activeFindAndFilters();
        const search = currentSearchState();
        renderSearchAssistChips(controls);
        if (!filters.length && !search.q) {
          el.resultSummary.replaceChildren();
          return;
        }
        const sessionTotal = state.sessionGrandTotal || state.sessionTotal;
        const countText = filters.length && sessionTotal ? t("sessionsMatchTotal", { count: state.sessionTotal, total: sessionTotal }) : filters.length ? t("sessionsMatch", { count: state.sessionTotal }) : "";
        const eventText = filters.length && state.selectedSessionId ? state.offset < state.timelineTotal ? t("eventsMatchLoaded", { count: state.timelineTotal, loaded: state.offset }) : t("eventsMatch", { count: state.timelineTotal }) : filters.length ? t("eventsSelectSession") : "";
        const matchControls = search.q ? `<div class="searchMatchControls" data-search-match-controls title="${escapeHtml(t("searchMatchTitle"))}">
      <span class="searchMatchCount" data-search-match-count>${escapeHtml(currentSearchMarkLabel())}</span>
    </div>` : "";
        const countMarkup = [countText, eventText].filter(Boolean).join(" \xB7 ");
        const filterText = renderFilterChips(controls) + `<button class="clearFiltersBtn" type="button" data-clear-filter="all">${escapeHtml(t("clearAll"))}</button>`;
        el.resultSummary.innerHTML = `${countMarkup ? `<div class="resultCounts">${escapeHtml(countMarkup)}</div>` : ""}${matchControls}<div class="activeFilters" aria-label="${escapeHtml(t("activeFindFilters"))}">${filterText}</div>`;
        updateSearchMatchControls();
      }
      function clearActiveFilter(key) {
        const structureBefore = structuredSearchKey();
        if (key === "all") {
          el.searchInput.value = "";
          state.layerId = "main";
          el.layerSelect.value = state.layerId;
          localStorage.setItem("sessionAnalyzer.layer", state.layerId);
        } else if (key === "q") {
          el.searchInput.value = searchQuery.removeFreeText(el.searchInput.value);
        } else if (key === "file") {
          el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, "file");
        } else if (key === "kind") {
          el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, "kind");
        } else if (key === "status") {
          el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, "status");
        } else if (key === "layer") {
          el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, "layer");
          state.layerId = "main";
          el.layerSelect.value = state.layerId;
          localStorage.setItem("sessionAnalyzer.layer", state.layerId);
        }
        syncSearchAssistControls();
        renderSearchAssistChips();
        updateProfileApplicabilityUi();
        const structureAfter = structuredSearchKey();
        state.searchStructureKey = structureAfter;
        if (structureBefore === structureAfter) {
          refreshTimelineFindState().catch(showError);
        } else {
          loadSessions().catch(showError);
        }
      }
      function resetTimelineScroll() {
        const pane = el.timeline.closest(".timelinePane");
        if (pane) pane.scrollTop = 0;
      }
      function eventPrimaryLine(event) {
        const line = event?.rawRefs?.[0]?.line ?? event?.source?.line ?? 0;
        const number = Number(line);
        return Number.isFinite(number) ? number : 0;
      }
      function captureFocusAnchor() {
        const event = currentSelectedEvent();
        if (!event) return { hadSelection: false };
        return {
          hadSelection: true,
          eventId: event.id,
          timestamp: event.timestamp || "",
          line: eventPrimaryLine(event),
          detailType: state.detailView?.type === "rawRefs" ? "rawRefs" : "inspector"
        };
      }
      function compareEventToAnchor(event, anchor) {
        const eventTime = event.timestamp || "";
        const anchorTime = anchor.timestamp || "";
        if (eventTime !== anchorTime) return eventTime < anchorTime ? -1 : 1;
        return eventPrimaryLine(event) - (anchor.line || 0);
      }
      function isVisibleFocusCandidate(event) {
        return displayState(event) !== "hidden";
      }
      function isExpandedFocusCandidate(event) {
        return displayState(event) === "expanded";
      }
      async function allFocusEvents() {
        const cache = await ensureNavigationEvents();
        return cache?.events || state.currentEvents;
      }
      async function resolveFocusTarget(anchor) {
        const events = await allFocusEvents();
        if (!events.length) return null;
        if (!anchor?.hadSelection) {
          return events.find(isExpandedFocusCandidate) || null;
        }
        const sameEvent = events.find((event) => event.id === anchor.eventId);
        if (sameEvent && isVisibleFocusCandidate(sameEvent)) return sameEvent;
        const insertionIndex = events.findIndex((event) => compareEventToAnchor(event, anchor) >= 0);
        const startIndex = insertionIndex >= 0 ? insertionIndex : events.length;
        for (let index = startIndex; index < events.length; index += 1) {
          if (isVisibleFocusCandidate(events[index])) return events[index];
        }
        for (let index = Math.min(startIndex - 1, events.length - 1); index >= 0; index -= 1) {
          if (isVisibleFocusCandidate(events[index])) return events[index];
        }
        return null;
      }
      async function restoreFocus(anchor) {
        if (!state.selectedSessionId) return null;
        const target = await resolveFocusTarget(anchor);
        if (!target) {
          if (anchor?.hadSelection) closeDetailView();
          return null;
        }
        await ensureEventLoaded(target.id);
        const loaded = state.currentEvents.find((event) => event.id === target.id) || target;
        if (anchor?.detailType === "rawRefs") await showRaw(loaded, { replace: true });
        else showInspector(loaded, { replace: true });
        scrollToTimelineEvent(loaded.id);
        return loaded;
      }
      function clearCurrentSessionOverrides() {
        if (!state.selectedSessionId || !state.overrides[state.selectedSessionId]) return;
        delete state.overrides[state.selectedSessionId];
        saveOverrides();
        updateResetFoldsButton();
      }
      function saveOverrides() {
        state.overrides = normalizeOverrides(state.overrides);
        writeJsonStorage(OVERRIDES_KEY, state.overrides);
      }
      function hasCurrentSessionOverrides() {
        const sessionOverrides = state.overrides[state.selectedSessionId] || {};
        return Object.keys(sessionOverrides).length > 0;
      }
      function updateResetFoldsButton() {
        if (!el.resetFoldsBtn) return;
        const visible = hasCurrentSessionOverrides();
        el.resetFoldsBtn.hidden = !visible;
        el.resetFoldsBtn.closest(".foldControls")?.toggleAttribute("data-has-reset-folds", visible);
      }
      function updateProfileApplicabilityUi(analyzerDisabled = false) {
        const applies = profileAppliesToActiveLayer();
        const controls = el.profileSelect?.closest(".foldControls");
        if (el.profileSelect) {
          el.profileSelect.disabled = analyzerDisabled || !applies;
          const label = applies ? t("foldingStrategy") : t("fixedProfileRules");
          el.profileSelect.removeAttribute("title");
          el.profileSelect.setAttribute("aria-label", label);
        }
        syncProfileInfoSlot(analyzerDisabled);
        controls?.toggleAttribute("data-profile-inactive", !applies);
      }
      function setAnalyzerDisabled(disabled) {
        for (const control of [el.searchInput, el.layerSelect, el.sortSelect, el.resetFoldsBtn, el.loadMoreBtn]) {
          if (control) control.disabled = disabled;
        }
        updateProfileApplicabilityUi(disabled);
      }
      function setProjectMode(selecting) {
        state.selectingProject = selecting;
        state.projectSelected = !selecting;
        document.body.dataset.projectMode = selecting ? "selecting" : "analyzing";
        if (el.projectChooser) el.projectChooser.hidden = !selecting;
        setAnalyzerDisabled(selecting);
        updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
      }
      function resetProjectViewState() {
        state.sessions = [];
        state.selectedSessionId = "";
        state.selectedEventId = "";
        state.offset = 0;
        state.timelineLoading = false;
        state.timelineRequestId += 1;
        state.sessionGrandTotal = 0;
        state.sessionTotal = 0;
        state.timelineTotal = 0;
        state.timelineSearchMatchCount = 0;
        state.currentEvents = [];
        state.searchTargetPreload = { key: "", pages: 0, pending: false };
        state.fileSuggestions = [];
        state.eventKinds = { main: [], protocol: [], raw: [] };
        state.sessionEventKinds = { main: [], protocol: [], raw: [] };
        resetSessionDetailCache();
        invalidateNavigationCache();
        el.sessionList.innerHTML = "";
        el.analysisPanel.innerHTML = "";
        el.timeline.innerHTML = "";
        el.resultSummary.textContent = "";
        el.sessionHeader.innerHTML = `<h2>${escapeHtml(t("chooseSession"))}</h2><p>${escapeHtml(t("selectSessionFirst"))}</p>`;
        el.loadMoreBtn.disabled = true;
        el.loadMoreBtn.textContent = t("loadMore");
        updateResetFoldsButton();
        resetDetailPane();
      }
      function renderProjects() {
        if (!el.projectList) return;
        const loadingRoot = state.projectLoadingRoot;
        el.projectList.setAttribute("aria-busy", loadingRoot ? "true" : "false");
        if (el.projectChooser) el.projectChooser.dataset.loading = loadingRoot ? "true" : "false";
        if (!state.projects.length) {
          el.projectList.innerHTML = loadingRoot ? "" : `<div class="notice warning"><p>${escapeHtml(t("noCodexProjects"))}</p></div>`;
          return;
        }
        const saved = localStorage.getItem(REPO_STORAGE_KEY) || "";
        el.projectList.innerHTML = state.projects.map((project) => {
          const isSaved = project.repoRoot === saved;
          const isLoading = project.repoRoot === loadingRoot;
          const statsPending = Boolean(project.statsPending);
          const sessionCount = Number(project.sessionCount || 0);
          const classes = [
            "projectItem",
            isSaved ? "lastSelected" : "",
            project.exists ? "" : "missing",
            isLoading ? "loading" : ""
          ].filter(Boolean).join(" ");
          const badges = [
            isSaved ? `<span class="projectBadge">${escapeHtml(t("lastSelected"))}</span>` : "",
            project.exists ? "" : `<span class="projectBadge warning">${escapeHtml(t("missingDirectory"))}</span>`
          ].join("");
          const action = isLoading ? `<span class="projectSpinner" aria-hidden="true"></span><span>${escapeHtml(t("indexing"))}</span>` : `<span>${escapeHtml(t("open"))}</span>`;
          const facts = statsPending ? `<span>${escapeHtml(t("activityLoading"))}</span>` : `<span>${escapeHtml(t("sessionCount", { count: sessionCount }))}</span><span>${escapeHtml(project.updatedAt ? fmtDate(project.updatedAt) : t("noTranscriptActivity"))}</span>`;
          return `<button class="${classes}" type="button" data-project-root="${escapeHtml(project.repoRoot)}"${loadingRoot ? " disabled" : ""}>
      <span class="projectMain">
        <span class="projectName">${escapeHtml(projectName(project.repoRoot))}${badges}</span>
        <span class="projectPath">${escapeHtml(project.repoRoot)}</span>
      </span>
      <span class="projectFacts" aria-label="${escapeHtml(t("projectActivity"))}">
        ${facts}
      </span>
      <span class="projectAction">${action}</span>
    </button>`;
        }).join("");
      }
      function clearProjectPollTimer() {
        if (!state.projectPollTimer) return;
        clearTimeout(state.projectPollTimer);
        state.projectPollTimer = 0;
      }
      function isActiveProjectChooserRequest(requestId) {
        return requestId === state.projectChooserRequestId && state.selectingProject && !state.projectLoadingRoot && !state.projectJobId;
      }
      function resetSessionDetailCache() {
        state.detailCache = {};
        state.detailErrors = {};
        state.detailPending = {};
        state.detailCacheGeneration += 1;
      }
      async function cancelProjectJob(jobId) {
        if (!jobId) return;
        try {
          await api(`/api/project/status?jobId=${encodeURIComponent(jobId)}`, { method: "DELETE" });
        } catch (error) {
          if (error.status !== 404) throw error;
        }
      }
      async function showProjectChooser(options = {}) {
        const requestId = state.projectChooserRequestId + 1;
        state.projectChooserRequestId = requestId;
        state.projectReturning = false;
        setProjectMode(true);
        state.projectLoadingRoot = "";
        state.projectJobId = "";
        updateProjectChrome({ displayRoot: "", returnRoot: state.repoRoot });
        clearProjectPollTimer();
        resetProjectViewState();
        setProjectHeader("", t("chooseTargetProjectContinue"));
        if (el.projectStatus) el.projectStatus.textContent = t("loadingProjectList");
        if (el.projectProgress) el.projectProgress.hidden = true;
        if (el.projectCancelBtn) el.projectCancelBtn.hidden = true;
        if (el.projectList) el.projectList.innerHTML = "";
        let renderedSummary = false;
        try {
          const summary = await api("/api/projects?summary=1");
          if (!isActiveProjectChooserRequest(requestId)) return;
          state.projects = summary.projects;
          renderedSummary = state.projects.length > 0;
          if (renderedSummary) renderProjects();
          if (el.projectStatus) {
            el.projectStatus.textContent = renderedSummary ? t("projectActivityLoading", { codexHome: summary.codexHome }) : t("discoveringProjects");
          }
        } catch (error) {
          console.warn("Unable to load project summary", error);
        }
        if (!isActiveProjectChooserRequest(requestId)) return;
        const data = await api("/api/projects");
        if (!isActiveProjectChooserRequest(requestId)) return;
        state.projects = data.projects;
        renderProjects();
        if (el.projectStatus) el.projectStatus.textContent = state.projects.length ? t("projectCandidates", { count: state.projects.length, codexHome: data.codexHome }) : t("noProjectCandidates", { codexHome: data.codexHome });
        const saved = localStorage.getItem(REPO_STORAGE_KEY);
        if (options.autoRestore && saved && state.projects.some((project) => project.repoRoot === saved)) {
          await selectProject(saved, { restore: true });
        }
      }
      async function exitProjectChooser() {
        state.projectChooserRequestId += 1;
        const jobId = state.projectJobId;
        state.projectReturning = true;
        clearProjectPollTimer();
        state.projectLoadingRoot = "";
        state.projectJobId = "";
        updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
        try {
          await cancelProjectJob(jobId);
          const appState = await api("/api/state");
          const currentState = appState.currentState || (!appState.job ? appState : null);
          if (!currentState?.projectSelected) throw new Error(t("projectUnavailable"));
          await finishProjectSelection(currentState, { restore: true });
        } catch (error) {
          state.projectReturning = false;
          updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
          throw error;
        }
      }
      async function applyAppState(appState) {
        if (appState.locale) state.locale = i18n.resolveLocale(appState.locale);
        applyStaticLocale();
        state.repoRoot = appState.repoRoot || "";
        state.builtinProfiles = normalizeProfiles(appState.foldingProfiles);
        state.profiles = normalizeProfiles([...state.builtinProfiles, ...state.customProfiles]);
        state.eventKinds = appState.eventKinds;
        state.sessionGrandTotal = appState.totals.sessionCount || 0;
        setProjectHeader(
          appState.repoRoot,
          [
            t("sessionCount", { count: appState.totals.sessionCount }),
            t("logicalEventCount", { count: appState.totals.eventCount }),
            t("rawRecordCount", { count: appState.totals.rawEventCount })
          ].join(" | ")
        );
        el.profileSelect.innerHTML = renderProfileOptions();
        el.profileSelect.value = state.profileId;
        if (!el.profileSelect.value) {
          state.profileId = "narrative";
          el.profileSelect.value = state.profileId;
          localStorage.setItem("sessionAnalyzer.profile", state.profileId);
        }
        syncProfileInfoSlot();
        updateProfileApplicabilityUi();
        resetProfileDraft();
        el.layerSelect.value = state.layerId;
        syncSearchAssistControls();
        const suggestionState = await api("/api/file-suggestions");
        state.fileSuggestions = suggestionState.files;
        renderFileSuggestions();
        resetDetailPane();
      }
      async function finishProjectSelection(appState, options = {}) {
        localStorage.setItem(REPO_STORAGE_KEY, appState.repoRoot);
        state.projectLoadingRoot = "";
        state.projectJobId = "";
        state.projectReturning = false;
        clearProjectPollTimer();
        updateProjectChrome({ displayRoot: appState.repoRoot, returnRoot: appState.repoRoot });
        renderProjects();
        resetProjectViewState();
        await applyAppState(appState);
        setProjectMode(false);
        await loadSessions();
        if (!options.restore && el.projectStatus) el.projectStatus.textContent = "";
        if (el.projectProgress) el.projectProgress.hidden = true;
        if (el.projectCancelBtn) el.projectCancelBtn.hidden = true;
      }
      async function changeLocale(locale) {
        const next = i18n.resolveLocale(locale);
        if (next === state.locale) return;
        const dirtyDraft = profileDirty() ? { profileId: state.profileId, rules: normalizeRules(cloneProfile(state.profileDraft).rules || defaultRules()) } : null;
        state.locale = next;
        localStorage.setItem(LOCALE_STORAGE_KEY, state.locale);
        resetSessionDetailCache();
        applyStaticLocale();
        if (state.projectSelected) {
          const appState = await api("/api/state");
          await applyAppState(appState.currentState || appState);
          await loadSessions();
          if (dirtyDraft && state.profileId === dirtyDraft.profileId && state.profiles.some((profile) => profile.id === dirtyDraft.profileId)) {
            state.profileDraft = cloneProfile(activeProfile());
            state.profileDraft.rules = normalizeRules(dirtyDraft.rules);
            renderTimeline();
            updateMetricActionStates();
            if (state.detailView.type === "profileRules") renderProfileRulesPane();
          }
        } else {
          renderProjects();
        }
      }
      async function handleProjectJobResponse(data, options = {}) {
        const job = data.job || {};
        if (job.id !== state.projectJobId) return;
        renderProjectJob(job);
        if (job.status === "succeeded") {
          let appState = data.state;
          if (!appState) appState = (await api(`/api/project/status?jobId=${encodeURIComponent(job.id)}`)).state;
          if (!appState) {
            const current = await api("/api/state");
            if (!current.job) appState = current;
          }
          if (!appState) throw new Error(t("projectIndexUnavailable"));
          await finishProjectSelection(appState, options);
          return;
        }
        if (job.status === "failed") throw new Error(job.error || t("indexingFailed"));
        if (job.status === "cancelled") {
          state.projectLoadingRoot = "";
          state.projectJobId = "";
          state.projectReturning = false;
          setAnalyzerDisabled(false);
          updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
          if (el.projectStatus) el.projectStatus.textContent = t("indexingCancelledSentence");
          if (el.projectProgress) el.projectProgress.hidden = true;
          if (el.projectCancelBtn) el.projectCancelBtn.hidden = true;
          if (state.projects.length) renderProjects();
          else await showProjectChooser({ autoRestore: false });
          return;
        }
        scheduleProjectJobPoll(job.id, options);
      }
      async function pollProjectJob(jobId, options = {}) {
        clearProjectPollTimer();
        const data = await api(`/api/project/status?jobId=${encodeURIComponent(jobId)}`);
        if (jobId !== state.projectJobId) return;
        await handleProjectJobResponse(data, options);
      }
      function handleProjectJobError(jobId, error) {
        if (jobId !== state.projectJobId) return;
        showError(error);
      }
      function scheduleProjectJobPoll(jobId, options = {}) {
        state.projectPollTimer = setTimeout(() => {
          pollProjectJob(jobId, options).catch((error) => handleProjectJobError(jobId, error));
        }, 400);
      }
      async function selectProject(repoRoot, options = {}) {
        if (!repoRoot) return;
        const requestId = state.projectChooserRequestId + 1;
        state.projectChooserRequestId = requestId;
        state.projectReturning = false;
        state.projectLoadingRoot = repoRoot;
        state.projectJobId = "";
        clearProjectPollTimer();
        updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
        renderProjects();
        if (el.projectStatus) el.projectStatus.textContent = t("readingMatchingSessions", { repoRoot });
        setAnalyzerDisabled(true);
        try {
          const started = await api("/api/project", {
            method: "POST",
            body: { repoRoot, locale: state.locale }
          });
          const job = started.job || {};
          if (requestId !== state.projectChooserRequestId) {
            await cancelProjectJob(job.id || "");
            return;
          }
          state.projectJobId = job.id || "";
          renderProjectJob(job);
          if (state.projectJobId) await pollProjectJob(state.projectJobId, options);
        } catch (error) {
          if (requestId !== state.projectChooserRequestId) return;
          clearProjectPollTimer();
          state.projectJobId = "";
          state.projectLoadingRoot = "";
          state.projectReturning = false;
          updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
          renderProjects();
          setAnalyzerDisabled(false);
          throw error;
        }
      }
      async function init() {
        setMobileView(state.mobileView, { scroll: false });
        try {
          const appState = await api("/api/state");
          if (appState.job) {
            const job = appState.job;
            setProjectMode(true);
            state.projectLoadingRoot = job.repoRoot || "";
            state.projectJobId = job.id || "";
            updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
            resetProjectViewState();
            renderProjectJob(job);
            renderProjects();
            if (state.projectJobId) await pollProjectJob(state.projectJobId, { restore: true });
            return;
          }
          await applyAppState(appState);
          setProjectMode(false);
        } catch (error) {
          if (error.status !== 409) throw error;
          await showProjectChooser({ autoRestore: true });
          if (state.projectSelected) return;
          return;
        }
        await loadSessions();
      }
      async function loadSessions() {
        updateProfileApplicabilityUi();
        state.searchStructureKey = structuredSearchKey();
        const data = await api(`/api/sessions${currentQuery({ sort: el.sortSelect.value }, { includeQ: false })}`);
        state.sessions = data.sessions;
        state.sessionTotal = data.total;
        renderSessions();
        if (!state.selectedSessionId && data.sessions[0]) {
          await selectSession(data.sessions[0].id);
        } else if (state.selectedSessionId && !data.sessions.some((session) => session.id === state.selectedSessionId)) {
          state.selectedSessionId = "";
          state.offset = 0;
          state.timelineLoading = false;
          state.timelineRequestId += 1;
          state.timelineTotal = 0;
          state.currentEvents = [];
          state.sessionEventKinds = { main: [], protocol: [], raw: [] };
          syncSearchAssistControls();
          el.timeline.innerHTML = "";
          el.analysisPanel.innerHTML = "";
          updateLoadMoreButton();
          updateResetFoldsButton();
          el.sessionHeader.innerHTML = `<h2>${escapeHtml(t("noMatchingSession"))}</h2><p>${escapeHtml(t("adjustSearchFilters"))}</p>`;
          resetDetailPane();
          renderResultSummary();
        } else if (state.selectedSessionId) {
          await selectSession(state.selectedSessionId);
        } else {
          renderResultSummary();
        }
      }
      function renderSessions() {
        el.sessionList.innerHTML = state.sessions.map((session) => {
          const active = session.id === state.selectedSessionId;
          const relationship = sessionRelationshipLabel(session);
          const parentAttr = session.parentSessionId ? ` data-parent-session-id="${escapeHtml(session.parentSessionId)}"` : "";
          const relationshipTitle = sessionRelationshipTitle(session, relationship);
          return `<button class="${sessionItemClasses(session, active)}" type="button" data-session-id="${escapeHtml(session.id)}"${parentAttr}>
      <span class="sessionTitle">${escapeHtml(session.title)}</span>
      <span class="meta">${escapeHtml(fmtDate(session.updatedAt || session.startedAt))} | ${escapeHtml(fmtBytes(session.bytes))}</span>
      <span class="chips">
        ${relationship ? `<span class="chip relationshipChip" title="${escapeHtml(relationshipTitle)}">${escapeHtml(relationship)}</span>` : ""}
        <span class="chip">${escapeHtml(t("messageCountShort", { count: session.counts.messages }))}</span>
        <span class="chip">${escapeHtml(t("toolCountShort", { count: session.counts.toolCalls }))}</span>
        <span class="chip">${escapeHtml(t("failedCommandCountShort", { count: session.counts.failedCommands }))}</span>
        <span class="chip">${escapeHtml(t("protocolCountShort", { count: session.protocolCount }))}</span>
      </span>
    </button>`;
        }).join("");
        refreshSearchHighlights({ preserveActive: true });
      }
      async function selectSession(sessionId, options = {}) {
        if (state.selectedSessionId !== sessionId) resetSessionDetailCache();
        state.selectedSessionId = sessionId;
        state.offset = 0;
        state.timelineLoading = false;
        state.timelineRequestId += 1;
        state.currentEvents = [];
        state.sessionEventKinds = { main: [], protocol: [], raw: [] };
        state.searchTargetPreload = { key: "", pages: 0, pending: false };
        invalidateNavigationCache();
        updateResetFoldsButton();
        renderSessions();
        resetDetailPane();
        const session = state.sessions.find((item) => item.id === sessionId);
        if (session) {
          const relationship = sessionRelationshipLabel(session);
          el.sessionHeader.innerHTML = `<h2>${escapeHtml(session.title)}</h2>
      <div class="sessionMeta" aria-label="${escapeHtml(t("sessionMetadata"))}">
        ${relationship ? `<span class="sessionMetaChip">${escapeHtml(relationship)}</span>` : ""}
        <span class="sessionMetaChip">${escapeHtml(fmtDate(session.startedAt))} - ${escapeHtml(fmtDate(session.updatedAt))}</span>
        <span class="sessionSource" title="${escapeHtml(session.sourceFile)}">${escapeHtml(session.sourceFile)}</span>
      </div>`;
        }
        await Promise.all([loadAnalysis(sessionId), loadTimeline(false)]);
        if (options.mobileView) setMobileView(options.mobileView);
      }
      async function loadAnalysis(sessionId) {
        const analysis = await api(`/api/sessions/${encodeURIComponent(sessionId)}/analysis`);
        const planCount = analysis.counts.planEvents ?? analysis.counts.planArtifacts;
        const issueCount = analysis.counts.issueEvents ?? analysis.counts.failedCommands;
        el.analysisPanel.innerHTML = [
          metric(t("metricTurns"), analysis.counts.turns),
          metric(t("metricMessages"), analysis.counts.messages, { action: "profile", value: "conversation", label: t("switchToConversationProfile") }),
          metric(t("metricIssues"), issueCount, { action: "profile", value: "debug", label: t("switchToIssueProfile") }),
          metric(t("metricFiles"), analysis.patchedFiles.length, { action: "profile", value: "changes", label: t("switchToChangesProfile") }),
          metric(t("metricProtocol"), analysis.counts.protocol, { action: "layer", value: "protocol", label: t("switchToProtocolLayer") }),
          metric(t("metricPlans"), planCount, { action: "profile", value: "planning", label: t("switchToPlanningProfile") })
        ].join("");
      }
      function isMetricActionActive(action) {
        if (!action) return false;
        if (action.action === "profile" && !profileAppliesToActiveLayer()) return false;
        if (action.action === "profile") return state.profileId === action.value;
        if (action.action === "layer") return activeLayerId() === action.value;
        return false;
      }
      function metric(label, value, action = null) {
        const hasValue = Number(value) > 0;
        const disabledProfileAction = action?.action === "profile" && !profileAppliesToActiveLayer() && hasValue;
        const isActionable = action && hasValue && !disabledProfileAction;
        const actionLabel = disabledProfileAction ? t("metricShortcutMainOnly", { label }) : action?.label ? t("metricActionCount", { action: action.label, value, label }) : "";
        const actionAttrs = isActionable ? ` role="button" tabindex="0" aria-pressed="${isMetricActionActive(action) ? "true" : "false"}" aria-label="${escapeHtml(actionLabel)}" title="${escapeHtml(actionLabel)}" data-metric-action="${escapeHtml(action.action)}" data-metric-value="${escapeHtml(action.value)}"` : disabledProfileAction ? ` aria-disabled="true" title="${escapeHtml(actionLabel)}"` : "";
        const classes = [
          "metric",
          isActionable ? "filterable" : "",
          disabledProfileAction ? "disabled" : "",
          isActionable && isMetricActionActive(action) ? "active" : ""
        ].filter(Boolean).join(" ");
        return `<div class="${classes}"${actionAttrs}><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
      }
      function syncMetricAction(metricEl) {
        const action = {
          action: metricEl.dataset.metricAction,
          value: metricEl.dataset.metricValue
        };
        const active = isMetricActionActive(action);
        metricEl.classList.toggle("active", active);
        metricEl.setAttribute("aria-pressed", active ? "true" : "false");
      }
      function updateMetricActionStates() {
        el.analysisPanel?.querySelectorAll("[data-metric-action]").forEach(syncMetricAction);
      }
      async function applyMetricAction(metricEl) {
        const action = metricEl.dataset.metricAction;
        if (action === "profile" && !profileAppliesToActiveLayer()) return;
        if (action === "profile") {
          const targetProfileId = metricEl.dataset.metricValue;
          if (state.profileId === targetProfileId) {
            const previousProfileId2 = state.profiles.some((profile) => profile.id === state.previousProfileBeforeMetric && profile.id !== targetProfileId) ? state.previousProfileBeforeMetric : "narrative";
            if (await changeProfile(previousProfileId2)) state.previousProfileBeforeMetric = "";
            updateMetricActionStates();
            return;
          }
          const previousProfileId = state.profileId;
          if (await changeProfile(targetProfileId)) {
            state.previousProfileBeforeMetric = previousProfileId;
          }
          updateMetricActionStates();
          return;
        }
        if (action === "layer") {
          await applyMetricLayer(metricEl.dataset.metricValue);
        }
      }
      async function applyMetricLayer(targetLayerId) {
        const currentLayerId = activeLayerId();
        if (currentLayerId === targetLayerId) {
          const previousLayerId = ["main", "protocol", "raw"].includes(state.previousLayerBeforeProtocol) && state.previousLayerBeforeProtocol !== targetLayerId ? state.previousLayerBeforeProtocol : "main";
          await changeLayer(previousLayerId);
          state.previousLayerBeforeProtocol = "";
          return;
        }
        state.previousLayerBeforeProtocol = currentLayerId;
        await changeLayer(targetLayerId);
      }
      async function changeLayer(layerId) {
        if (!["main", "protocol", "raw"].includes(layerId)) return;
        const focusAnchor = captureFocusAnchor();
        state.layerId = layerId;
        el.layerSelect.value = state.layerId;
        el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, "layer");
        localStorage.setItem("sessionAnalyzer.layer", state.layerId);
        syncSearchAssistControls();
        updateProfileApplicabilityUi();
        if (state.detailView.type === "profileRules") renderProfileRulesPane();
        await loadSessions();
        await restoreFocus(focusAnchor);
        updateMetricActionStates();
      }
      function updateLoadMoreButton() {
        if (!el.loadMoreBtn) return;
        const hasMore = state.offset < state.timelineTotal;
        el.loadMoreBtn.disabled = !state.selectedSessionId || state.timelineLoading || !hasMore;
        if (state.timelineLoading) {
          el.loadMoreBtn.textContent = t("loading");
        } else {
          el.loadMoreBtn.textContent = hasMore ? t("loadMoreCount", { loaded: state.offset, total: state.timelineTotal }) : t("loadedCount", { loaded: state.offset });
        }
      }
      async function loadTimeline(append, options = {}) {
        if (!state.selectedSessionId) return;
        if (append && state.timelineLoading) return;
        const sessionId = state.selectedSessionId;
        const requestId = state.timelineRequestId + 1;
        state.timelineRequestId = requestId;
        state.timelineLoading = true;
        updateLoadMoreButton();
        try {
          const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/timeline${currentQuery({
            offset: append ? state.offset : 0,
            limit: state.limit
          })}`);
          if (requestId !== state.timelineRequestId || sessionId !== state.selectedSessionId) return;
          if (append) {
            state.currentEvents = state.currentEvents.concat(data.events);
          } else {
            state.currentEvents = data.events;
          }
          state.offset = state.currentEvents.length;
          state.timelineTotal = data.total;
          state.timelineSearchMatchCount = data.searchMatchCount || 0;
          state.sessionEventKinds = data.eventKinds;
          syncSearchAssistControls();
          renderTimeline();
          if (!append && !options.keepScroll) resetTimelineScroll();
          renderResultSummary();
          maybePreloadSearchTargets();
        } finally {
          if (requestId === state.timelineRequestId) {
            state.timelineLoading = false;
            updateLoadMoreButton();
            maybePreloadSearchTargets();
          }
        }
      }
      async function refreshTimelineFindState(options = {}) {
        if (!state.selectedSessionId) return;
        const sessionId = state.selectedSessionId;
        const targetCount = Math.max(state.currentEvents.length, state.offset, state.limit);
        if (!targetCount) {
          await loadTimeline(false, { keepScroll: true, ...options });
          return;
        }
        const requestId = state.timelineRequestId + 1;
        state.timelineRequestId = requestId;
        state.timelineLoading = true;
        updateLoadMoreButton();
        try {
          const events = [];
          let total = 0;
          let searchMatchCount = 0;
          let eventKinds = null;
          while (events.length < targetCount) {
            const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/timeline${currentQuery({
              offset: events.length,
              limit: Math.min(500, targetCount - events.length)
            })}`);
            if (requestId !== state.timelineRequestId || sessionId !== state.selectedSessionId) return;
            total = data.total;
            searchMatchCount = data.searchMatchCount || 0;
            eventKinds = data.eventKinds;
            events.push(...data.events);
            if (!data.events.length || events.length >= total) break;
          }
          state.currentEvents = events;
          state.offset = events.length;
          state.timelineTotal = total;
          state.timelineSearchMatchCount = searchMatchCount;
          state.sessionEventKinds = eventKinds;
          syncSearchAssistControls();
          renderTimeline();
          refreshSearchSensitiveDetailView();
          renderResultSummary();
          maybePreloadSearchTargets();
        } finally {
          if (requestId === state.timelineRequestId) {
            state.timelineLoading = false;
            updateLoadMoreButton();
            maybePreloadSearchTargets();
          }
        }
      }
      function naturalDisplayState(event) {
        const layer = activeLayerId();
        if (layer === "protocol") {
          return event.kind === "protocol" ? "summary" : "collapsed";
        }
        if (layer === "raw") {
          return ["event_msg", "response_item"].includes(event.recordType) ? "collapsed" : "summary";
        }
        const profile = { ...activeProfile(), rules: activeProfileRules() };
        return evaluateDisplayStateFromRules(event, profile?.rules || defaultRules());
      }
      function displayState(event) {
        const sessionOverrides = state.overrides[state.selectedSessionId] || {};
        if (sessionOverrides[event.id]) return sessionOverrides[event.id];
        return naturalDisplayState(event);
      }
      function foldedDisplayState(event) {
        const natural = naturalDisplayState(event);
        return ["summary", "collapsed"].includes(natural) ? natural : "collapsed";
      }
      function renderEventBody(event, display) {
        if (display !== "expanded") return "";
        const key = detailKey(state.selectedSessionId, activeLayerId(), event.id);
        const detail = state.detailCache[key];
        const error = state.detailErrors[key];
        if (detail) {
          const preview = event.snippet || event.preview || event.label;
          return `<div class="eventBody">${renderTimelineSections(detail.timelineSections, preview)}</div>`;
        }
        if (error) {
          return `<div class="eventBody"><div class="notice error"><p>${escapeHtml(error)}</p></div><button class="smallBtn" type="button" data-action="retry-detail">${escapeHtml(t("retryDetail"))}</button></div>`;
        }
        const snippet = event.hasSearchHit && event.snippet ? `<div class="eventPreview eventLoadingSnippet">${escapeHtml(event.snippet)}</div>` : "";
        return `<div class="eventBody">${snippet}<div class="notice info"><p>${escapeHtml(t("loadingStructuredDetail"))}</p></div></div>`;
      }
      function renderEventFooterActions(display) {
        if (display !== "expanded") return "";
        const label = t("collapseEvent");
        return `<div class="eventFooterActions">
    <button class="eventCollapseBtn" type="button" data-action="toggle" aria-label="${label}" title="${label}">
      <svg class="eventCollapseIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 15l6-6 6 6"></path>
      </svg>
      <span class="srOnly">${label}</span>
    </button>
  </div>`;
      }
      function renderEventPreview(event, display) {
        if (display === "expanded") return "";
        if (event.kind === "usage_limit_warning" && event.usageLimits?.length) {
          return `<div class="eventPreview usageLimitPreview">${renderUsageLimitPreview(event.usageLimits)}</div>`;
        }
        if (event.kind === "usage_limit_warning" && event.tokenUsage?.length) {
          return `<div class="eventPreview tokenPreview">${renderTokenUsageBadges(event.tokenUsage)}</div>`;
        }
        const preview = event.snippet || event.preview || event.label;
        return `<div class="eventPreview">${escapeHtml(preview)}</div>`;
      }
      function renderTokenUsageBadges(items) {
        return items.map((item) => {
          const primary = item.primary ? " primary" : "";
          return `<span class="tokenBadge${primary}"><span>${escapeHtml(item.label || "")}</span><strong>${escapeHtml(item.formatted ?? item.value ?? "")}</strong></span>`;
        }).join("");
      }
      function renderUsageLimitPreview(items) {
        return items.map((item) => `<div class="usageLimitMini"><strong>${escapeHtml(item.label || "")}</strong><span>${escapeHtml(item.remaining || "")} ${escapeHtml(t("remaining"))}</span><em>${escapeHtml(t("resets"))} ${escapeHtml(item.reset || "")}</em></div>`).join("");
      }
      function cssToken(value) {
        return String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
      }
      function renderTimeline() {
        el.timeline.innerHTML = state.currentEvents.map((event) => {
          const ds = displayState(event);
          const classes = [
            "event",
            ds,
            `state-${cssToken(ds)}`,
            `kind-${cssToken(event.kind)}`,
            event.severity,
            event.status ? `status-${cssToken(event.status)}` : "",
            event.id === state.selectedEventId ? "selected" : "",
            event.hasSearchHit ? "searchHit" : "",
            ds === "hidden" ? "hiddenByProfile" : ""
          ].filter(Boolean).join(" ");
          const chips = [
            event.status ? `<span class="chip statusChip statusChip-${cssToken(event.status)}">${escapeHtml(event.status)}</span>` : "",
            event.toolName ? `<span class="chip toolChip">${escapeHtml(event.toolName)}</span>` : "",
            event.touchedFiles?.length ? `<span class="chip countChip">${event.touchedFiles.length} ${escapeHtml(t("files"))}</span>` : "",
            event.rawRefs?.length ? `<span class="chip countChip">${event.rawRefs.length} ${escapeHtml(t("raw"))}</span>` : "",
            event.channels?.length ? `<span class="chip channelChip">${escapeHtml(event.channels.join(","))}</span>` : ""
          ].join("");
          const toggleLabel = ds === "expanded" ? t("collapseEvent") : t("expandEvent");
          return `<article class="${classes}" data-event-id="${escapeHtml(event.id)}">
      <div class="eventHeader">
        <button class="eventToggle" type="button" data-action="toggle" aria-label="${toggleLabel}" title="${toggleLabel}">
          <span class="srOnly">${toggleLabel}</span>
        </button>
        <span class="eventKind">${escapeHtml(event.label)}</span>
        ${chips ? `<span class="chips">${chips}</span>` : ""}
        <span class="eventTime">${escapeHtml(fmtDate(event.timestamp))}</span>
      </div>
      ${renderEventPreview(event, ds)}
      ${renderEventBody(event, ds)}
      ${renderEventFooterActions(ds)}
    </article>`;
        }).join("");
        queueVisibleDetailLoad();
        refreshSearchHighlights({ preserveActive: true });
      }
      function setOverride(eventId, value) {
        if (!state.overrides[state.selectedSessionId]) state.overrides[state.selectedSessionId] = {};
        state.overrides[state.selectedSessionId][eventId] = value;
        saveOverrides();
        updateResetFoldsButton();
      }
      function loadEventDetail(event) {
        const layer = activeLayerId();
        const sessionId = state.selectedSessionId;
        const generation = state.detailCacheGeneration;
        const key = detailKey(sessionId, layer, event.id);
        if (state.detailCache[key] || state.detailErrors[key]) return Promise.resolve();
        if (!state.detailPending[key]) {
          const pending = api(`/api/sessions/${encodeURIComponent(sessionId)}/events/${encodeURIComponent(event.id)}/detail?layer=${encodeURIComponent(layer)}`).then((detail) => {
            if (state.selectedSessionId !== sessionId || state.detailCacheGeneration !== generation) return;
            state.detailCache[key] = detail;
            delete state.detailErrors[key];
          }).catch((error) => {
            if (state.selectedSessionId !== sessionId || state.detailCacheGeneration !== generation) return;
            state.detailErrors[key] = error.message;
          }).finally(() => {
            if (state.detailPending[key] === pending) delete state.detailPending[key];
          });
          state.detailPending[key] = pending;
        }
        return state.detailPending[key];
      }
      function ensureEventDetail(event) {
        const key = detailKey(state.selectedSessionId, activeLayerId(), event.id);
        if (state.detailCache[key] || state.detailErrors[key]) return;
        loadEventDetail(event).then(() => renderTimeline());
      }
      function isInScrollport(element) {
        const rect = element.getBoundingClientRect();
        const scroller = element.closest(".timelinePane");
        const bounds = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
        return rect.bottom >= bounds.top && rect.top <= bounds.bottom;
      }
      function loadVisibleExpandedDetails() {
        state.detailViewportTimer = 0;
        for (const article of el.timeline.querySelectorAll(".event.expanded[data-event-id]")) {
          if (!isInScrollport(article)) continue;
          const item = state.currentEvents.find((candidate) => candidate.id === article.dataset.eventId);
          if (item) ensureEventDetail(item);
        }
      }
      function queueVisibleDetailLoad() {
        if (state.detailViewportTimer) cancelAnimationFrame(state.detailViewportTimer);
        state.detailViewportTimer = requestAnimationFrame(loadVisibleExpandedDetails);
      }
      function maybeLoadMoreTimeline(scroller) {
        if (!scroller || !state.selectedSessionId || state.timelineLoading || state.offset >= state.timelineTotal) return;
        const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        if (remaining <= TIMELINE_AUTO_LOAD_SCROLL_THRESHOLD) {
          loadTimeline(true).catch(showError);
        }
      }
      function onTimelinePaneScroll(event) {
        hideSearchAssist();
        queueVisibleDetailLoad();
        maybeLoadMoreTimeline(event.currentTarget);
      }
      function updateSelectedTimelineEvent() {
        for (const article of el.timeline.querySelectorAll(".event[data-event-id]")) {
          article.classList.toggle("selected", article.dataset.eventId === state.selectedEventId);
        }
      }
      function navigationCacheKey() {
        const search = currentSearchState();
        return JSON.stringify({
          sessionId: state.selectedSessionId,
          layer: search.layer,
          q: search.q,
          kind: search.kind,
          status: search.status,
          file: search.file
        });
      }
      function invalidateNavigationCache() {
        state.navigationCache = { key: "", events: [], total: 0, pending: null };
      }
      function currentNavigationCache() {
        const key = navigationCacheKey();
        return state.navigationCache.key === key && !state.navigationCache.pending ? state.navigationCache : null;
      }
      function ensureNavigationEvents() {
        const key = navigationCacheKey();
        if (state.navigationCache.key === key && state.navigationCache.pending) return state.navigationCache.pending;
        if (state.navigationCache.key === key && state.navigationCache.events.length === state.navigationCache.total) {
          return Promise.resolve(state.navigationCache);
        }
        const pending = (async () => {
          const events = [];
          let total = 0;
          while (events.length === 0 || events.length < total) {
            if (navigationCacheKey() !== key) return null;
            const data = await api(`/api/sessions/${encodeURIComponent(state.selectedSessionId)}/timeline${currentQuery({
              offset: events.length,
              limit: NAVIGATION_PAGE_LIMIT
            })}`);
            total = data.total;
            events.push(...data.events);
            if (!data.events.length) break;
          }
          if (navigationCacheKey() !== key) return null;
          state.navigationCache = { key, events, total, pending: null };
          return state.navigationCache;
        })().finally(() => {
          if (state.navigationCache.key === key) state.navigationCache.pending = null;
        });
        state.navigationCache = { key, events: [], total: 0, pending };
        return pending;
      }
      function navigationCategoriesForEvent(event, events) {
        return navigationApi.navigationCategoriesForEvent(event, events, NAVIGATION_CATEGORIES);
      }
      function defaultNavigationCategoryId(event, categories) {
        const preferred = [
          event.hasSearchHit ? "search_hits" : "",
          isUpdatePlanEvent(event) ? "update_plan" : "",
          event.kind === "command" && event.status === "failed" ? "failed_commands" : "",
          event.kind === "patch" && event.status === "success" ? "patch_applied" : "",
          event.kind === "patch" && event.status === "failed" ? "patch_failed" : "",
          event.severity !== "normal" || event.status === "failed" ? "errors_warnings" : ""
        ].filter(Boolean);
        for (const id of preferred) {
          if (categories.some((category) => category.id === id)) return id;
        }
        return categories[0]?.id || "";
      }
      function selectedNavigationCategoryId(event, categories) {
        if (state.navigationCategoryManualId && categories.some((category) => category.id === state.navigationCategoryManualId)) {
          state.navigationCategoryId = state.navigationCategoryManualId;
          return state.navigationCategoryManualId;
        }
        const next = defaultNavigationCategoryId(event, categories);
        state.navigationCategoryId = next;
        return next;
      }
      function renderInspectorNavigation(event) {
        const cache = currentNavigationCache();
        if (!cache) {
          return `<nav class="eventNavigator" aria-label="${escapeHtml(t("eventQuickNavigation"))}"><span class="navStatus">${escapeHtml(t("loadingNavigation"))}</span></nav>`;
        }
        const categories = navigationCategoriesForEvent(event, cache.events);
        if (!categories.length) return "";
        const categoryId = selectedNavigationCategoryId(event, categories);
        const category = categories.find((item) => item.id === categoryId) || categories[0];
        const matches = category.matchesInResult;
        const index = matches.findIndex((candidate) => candidate.id === event.id);
        const position = index >= 0 ? index + 1 : 0;
        const categorySelect = categories.length > 1 ? `<select class="navSelect" data-navigation-category aria-label="${escapeHtml(t("quickNavigationCategory"))}">${categories.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === category.id ? " selected" : ""}>${escapeHtml(i18n.t(state.locale, "navigation", item.id) || item.label)}</option>`).join("")}</select>` : "";
        return `<nav class="eventNavigator" aria-label="${escapeHtml(t("eventQuickNavigation"))}">
    ${categorySelect}
    <button class="navBtn" type="button" data-detail-action="navigate-event" data-nav-direction="prev"${index <= 0 ? " disabled" : ""}>${escapeHtml(t("previous"))}</button>
    <span class="navPosition">${escapeHtml(`${position}/${matches.length}`)}</span>
    <button class="navBtn" type="button" data-detail-action="navigate-event" data-nav-direction="next"${index < 0 || index >= matches.length - 1 ? " disabled" : ""}>${escapeHtml(t("next"))}</button>
  </nav>`;
      }
      function currentSelectedEvent() {
        return state.currentEvents.find((candidate) => candidate.id === state.selectedEventId) || state.navigationCache.events.find((candidate) => candidate.id === state.selectedEventId) || null;
      }
      async function ensureEventLoaded(eventId) {
        if (state.currentEvents.some((event) => event.id === eventId)) return;
        while (state.offset < state.timelineTotal) {
          await loadTimeline(true);
          if (state.currentEvents.some((event) => event.id === eventId)) return;
        }
      }
      function scrollToTimelineEvent(eventId) {
        const article = el.timeline.querySelector(`[data-event-id="${CSS.escape(eventId)}"]`);
        if (article) article.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      async function inspectAndRevealEvent(target) {
        await ensureEventLoaded(target.id);
        const loaded = state.currentEvents.find((event) => event.id === target.id) || target;
        if (displayState(loaded) === "hidden") {
          setOverride(loaded.id, "summary");
          renderTimeline();
        }
        showInspector(loaded, { replace: true });
        scrollToTimelineEvent(loaded.id);
      }
      async function navigateSelectedEvent(direction) {
        const current = currentSelectedEvent();
        if (!current) return;
        const cache = await ensureNavigationEvents();
        if (!cache) return;
        const categories = navigationCategoriesForEvent(current, cache.events);
        if (!categories.length) return;
        const categoryId = selectedNavigationCategoryId(current, categories);
        const category = categories.find((item) => item.id === categoryId) || categories[0];
        const matches = category.matchesInResult;
        const index = matches.findIndex((event) => event.id === current.id);
        const nextIndex = direction === "next" ? index + 1 : index - 1;
        if (index < 0 || nextIndex < 0 || nextIndex >= matches.length) return;
        await inspectAndRevealEvent(matches[nextIndex]);
      }
      function pushDetailView(nextView) {
        if (state.detailView) state.detailHistory.push(state.detailView);
        state.detailView = nextView;
      }
      function replaceDetailView(nextView) {
        state.detailView = nextView;
      }
      function closeDetailView() {
        state.detailHistory = [];
        state.detailSelectionKey = "";
        state.selectedEventId = "";
        state.navigationCategoryId = "";
        state.navigationCategoryManualId = "";
        state.detailView = { type: "profileRules" };
        renderProfileRulesPane();
        updateSelectedTimelineEvent();
      }
      function backDetailView() {
        const previous = state.detailHistory.pop() || { type: "profileRules" };
        state.detailView = previous;
        renderCurrentDetailView();
      }
      function renderCurrentDetailView() {
        if (state.detailView.type === "inspector") {
          const item = currentSelectedEvent();
          if (item) showInspector(item, { replace: true });
          else closeDetailView();
          return;
        }
        if (state.detailView.type === "rawRefs") {
          const item = currentSelectedEvent();
          if (item) showRaw(item, { replace: true }).catch(showError);
          else closeDetailView();
          return;
        }
        renderProfileRulesPane();
      }
      function refreshSearchSensitiveDetailView() {
        if (state.detailView.type === "inspector" || state.detailView.type === "rawRefs") {
          renderCurrentDetailView();
        }
      }
      async function readFromSelectedEvent() {
        const anchor = { ...captureFocusAnchor(), detailType: "inspector" };
        if (!anchor.hadSelection) return;
        hideSearchAssist();
        el.searchInput.value = ["kind", "status", "file", "layer"].reduce(
          (input, operator) => searchQuery.removeOperator(input, operator),
          el.searchInput.value
        );
        state.layerId = "main";
        el.layerSelect.value = state.layerId;
        localStorage.setItem("sessionAnalyzer.layer", state.layerId);
        syncSearchAssistControls();
        renderSearchAssistChips();
        state.searchHighlight = { query: "", marks: [], activeIndex: -1 };
        state.timelineSearchMatchCount = 0;
        updateSearchMatchControls();
        updateProfileApplicabilityUi();
        await loadSessions();
        const restored = await restoreFocus(anchor);
        setMobileView("events");
        if (restored?.id) scrollToTimelineEvent(restored.id);
        updateMetricActionStates();
      }
      function renderDetailShell({ title, subtitle = "", actions = "", body = "", closeable = true, backable = state.detailHistory.length > 0, headerClass = "" }) {
        updateDetailViewChrome();
        const hasChromeControls = backable || closeable;
        const resolvedHeaderClass = [headerClass, hasChromeControls ? "detailChromeHeader" : ""].filter(Boolean).join(" ");
        const backButton = backable ? `<button class="detailIconBtn detailBackBtn" type="button" data-detail-action="back" aria-label="${escapeHtml(t("back"))}" title="${escapeHtml(t("back"))}">&larr;</button>` : "";
        const closeButton = closeable ? `<button class="detailIconBtn detailCloseBtn" type="button" data-detail-action="close" aria-label="${escapeHtml(t("close"))}" title="${escapeHtml(t("close"))}">&times;</button>` : "";
        el.detail.innerHTML = `<article class="detailView">
    <header class="detailViewHeader ${escapeHtml(resolvedHeaderClass)}">
      ${backButton}
      <div class="detailViewTitle">
        <h2>${escapeHtml(title)}</h2>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
      ${closeButton}
      ${actions ? `<div class="detailViewActions">${actions}</div>` : ""}
    </header>
    ${body}
  </article>`;
        syncProfileInfoSlot();
        refreshSearchHighlights({ preserveActive: true });
      }
      function renderProfileRulesPane(options = {}) {
        state.detailView = { type: "profileRules" };
        state.detailSelectionKey = "";
        state.selectedEventId = "";
        state.navigationCategoryId = "";
        state.navigationCategoryManualId = "";
        if (options.reveal === true) setMobileView("detail", { scroll: false });
        updateSelectedTimelineEvent();
        if (!profileAppliesToActiveLayer()) {
          const layer = activeLayerId();
          const fixedRuleText = layer === "protocol" ? t("protocolFixedRules") : t("rawFixedRules");
          renderDetailShell({
            title: t("foldingStrategy"),
            subtitle: t("fixedRuleSubtitle", { layer: activeLayerLabel() }),
            actions: `<button class="smallBtn" type="button" data-detail-action="view-main-layer">${escapeHtml(t("viewMainTimeline"))}</button>`,
            headerClass: "profileDetailHeader",
            closeable: false,
            backable: false,
            body: `<section class="profileRules profileRulesInactive">
        <div class="notice info">
          <p>${escapeHtml(t("fixedProfileRules"))}</p>
        </div>
        <section class="profileRuleSection">
          <h3>${escapeHtml(activeLayerLabel())}</h3>
          <p class="profileInactiveText">${escapeHtml(fixedRuleText)}</p>
        </section>
      </section>`
          });
          return;
        }
        if (!state.profileDraft) resetProfileDraft();
        const profile = activeProfile();
        const draft = state.profileDraft || cloneProfile(profile);
        const dirty = profileDirty();
        const status = dirty ? t("unsavedPreview") : "";
        const profileOptions = state.profiles.map((item) => {
          const name = dirty && item.id === state.profileId && isBuiltinProfile(item.id) ? nextCustomProfileName(item.id) : item.name;
          return `<option value="${escapeHtml(item.id)}"${item.id === state.profileId ? " selected" : ""}>${escapeHtml(name)}</option>`;
        }).join("");
        const stateOptions = (value, includeDisabled = false, states = DISPLAY_STATES) => [
          includeDisabled ? `<option value=""${value ? "" : " selected"}>${escapeHtml(t("disabled"))}</option>` : "",
          ...states.map((stateId) => `<option value="${stateId}"${stateId === value ? " selected" : ""}>${escapeHtml(displayStateLabel(stateId))}</option>`)
        ].join("");
        const rules = normalizeRules(draft.rules);
        const conditionMap = new Map(rules.conditions.map((condition) => [condition.id, condition.state]));
        const renderKindRow = (kind) => {
          const display = rules.kindStates[kind] || "";
          return `<label class="profileRuleRow">
      <span>
        <strong>${escapeHtml(kindLabel(kind))}</strong>
        <span>${escapeHtml(kind)}</span>
      </span>
      <select data-profile-kind="${escapeHtml(kind)}">
        <option value=""${display ? "" : " selected"}>${escapeHtml(displayStateLabel(rules.fallback))} (${escapeHtml(t("default"))})</option>
        ${DISPLAY_STATES.map((stateId) => `<option value="${stateId}"${stateId === display ? " selected" : ""}>${escapeHtml(displayStateLabel(stateId))}</option>`).join("")}
      </select>
    </label>`;
        };
        const explicitKinds = knownEventKinds().filter((kind) => rules.kindStates[kind]);
        const defaultKinds = knownEventKinds().filter((kind) => !rules.kindStates[kind]);
        const explicitKindRows = explicitKinds.map(renderKindRow).join("");
        const defaultKindRows = defaultKinds.map(renderKindRow).join("");
        const activeConditionRows = conditionDefinitions().filter((condition) => conditionMap.has(condition.id)).map((condition) => `<label class="profileRuleRow">
      <span>
        <strong>${escapeHtml(condition.name)}</strong>
        <span title="${escapeHtml(condition.description)}">${escapeHtml(condition.description)}</span>
      </span>
      <select data-profile-condition="${escapeHtml(condition.id)}">${stateOptions(conditionMap.get(condition.id) || "", true, CONDITION_DISPLAY_STATES)}</select>
    </label>`).join("");
        const inactiveConditionRows = conditionDefinitions().filter((condition) => !conditionMap.has(condition.id)).map((condition) => `<label class="profileRuleRow">
      <span>
        <strong>${escapeHtml(condition.name)}</strong>
        <span title="${escapeHtml(condition.description)}">${escapeHtml(condition.description)}</span>
      </span>
      <select data-profile-condition="${escapeHtml(condition.id)}">${stateOptions("", true, CONDITION_DISPLAY_STATES)}</select>
    </label>`).join("");
        const defaultKindNames = defaultKinds.map((kind) => kindLabel(kind)).join(", ");
        const saveIcon = `<svg class="profileActionIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 3h12l2 2v16H5z"></path>
    <path d="M8 3v6h8V3"></path>
    <path d="M8 21v-7h8v7"></path>
  </svg>`;
        const cancelIcon = `<svg class="profileActionIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 6l12 12"></path>
    <path d="M18 6L6 18"></path>
  </svg>`;
        const editActions = dirty ? `<span class="profileActionButtons">
      <button class="smallBtn profileActionIconBtn" type="button" data-detail-action="save-profile" aria-label="${escapeHtml(t("saveProfileChanges"))}" title="${escapeHtml(t("save"))}">${saveIcon}</button>
      <button class="smallBtn profileActionIconBtn" type="button" data-detail-action="cancel-profile" aria-label="${escapeHtml(t("cancelProfileChanges"))}" title="${escapeHtml(t("cancel"))}">${cancelIcon}</button>
    </span>` : "";
        const actions = `<div class="profileActionStack">
      <div class="profilePickerCompact" data-profile-picker-host="detail">
        <select data-profile-picker aria-label="${escapeHtml(t("strategy"))}">${profileOptions}</select>
      </div>
      ${editActions}
  </div>`;
        renderDetailShell({
          title: t("foldingStrategy"),
          subtitle: [status, draft.description].filter(Boolean).join(" | "),
          actions,
          headerClass: "profileDetailHeader",
          closeable: false,
          backable: false,
          body: `<section class="profileRules">
      <section class="profileRuleSection">
        <div class="profileRuleSectionHeader">
          <h3>${escapeHtml(t("eventKinds"))}</h3>
        </div>
        <div class="profileRuleList">${explicitKindRows || `<div class="profileRuleEmpty">${escapeHtml(t("noExplicitKindRules"))}</div>`}</div>
      </section>
      <details class="profileRuleDetails">
        <summary>
          <span>${escapeHtml(t("defaultKindCount", { count: defaultKinds.length }))}</span>
          <label class="profileDefaultInline">
            <span>${escapeHtml(t("default"))}</span>
            <select data-profile-fallback>${stateOptions(rules.fallback)}</select>
          </label>
        </summary>
        <p>${escapeHtml(defaultKindNames)}</p>
        <div class="profileRuleList">${defaultKindRows}</div>
      </details>
      <section class="profileRuleSection">
        <h3>${escapeHtml(t("conditions"))}</h3>
        <div class="profileRuleList">${activeConditionRows || `<div class="profileRuleEmpty">${escapeHtml(t("noActiveConditions"))}</div>`}</div>
      </section>
      <details class="profileRuleDetails">
        <summary>${escapeHtml(t("inactiveConditions", { count: conditionDefinitions().length - conditionMap.size }))}</summary>
        <div class="profileRuleList">${inactiveConditionRows}</div>
      </details>
    </section>`
        });
      }
      function showInspector(event, options = {}) {
        const layer = activeLayerId();
        const key = detailKey(state.selectedSessionId, layer, event.id);
        const refs = sourceRefs(event);
        const preview = event.snippet || event.preview || "";
        const detail = state.detailCache[key];
        const chips = renderChips(inspectorChipValues(event));
        state.selectedEventId = event.id;
        state.detailSelectionKey = key;
        if (options.replace) replaceDetailView({ type: "inspector", eventId: event.id });
        else pushDetailView({ type: "inspector", eventId: event.id });
        setMobileView("detail");
        updateSelectedTimelineEvent();
        if (!currentNavigationCache()) {
          ensureNavigationEvents().then(() => {
            if (state.detailSelectionKey === key && state.selectedEventId === event.id) showInspector(event, { replace: true });
          }).catch(showError);
        }
        renderDetailShell({
          title: event.label,
          actions: [renderReadFromHereAction(), renderInspectorNavigation(event)].filter(Boolean).join(""),
          body: `<div class="inspector">
    ${chips ? `<div class="chips">${chips}</div>` : ""}
    ${shouldShowInspectorSummary(event, preview, detail) ? `<section class="inspectorSection"><h3>Summary</h3><div class="inspectorLead">${escapeHtml(preview)}</div></section>` : ""}
    <section class="inspectorSection">
      <h3>Metadata</h3>
      <dl class="inspectorMeta">${renderInspectorMetadata(event, refs, detail)}</dl>
    </section>
    ${renderInspectorSource(event, refs, detail)}
    ${renderInspectorDetail(event)}
  </div>`
        });
        if (!state.detailCache[key] && !state.detailErrors[key]) {
          loadEventDetail(event).then(() => {
            if (state.detailSelectionKey === key) showInspector(event, { replace: true });
          });
        }
      }
      async function showRaw(event, options = {}) {
        const refs = sourceRefs(event);
        const layer = activeLayerId();
        const rawKey = `raw:${detailKey(state.selectedSessionId, layer, event.id)}`;
        state.selectedEventId = event.id;
        state.detailSelectionKey = rawKey;
        if (options.replace) replaceDetailView({ type: "rawRefs", eventId: event.id });
        else pushDetailView({ type: "rawRefs", eventId: event.id });
        setMobileView("detail");
        updateSelectedTimelineEvent();
        if (!refs.length) {
          renderDetailShell({
            title: t("rawRefs"),
            subtitle: rawRefsSubtitle(event),
            actions: [renderReadFromHereAction(), `<button class="smallBtn" type="button" data-detail-action="inspect">${escapeHtml(t("inspectEvent"))}</button>`].filter(Boolean).join(""),
            body: `<div class="rawRefsView">
      <div class="notice warning"><p>${escapeHtml(t("noRawRows"))}</p></div>
    </div>`
          });
          return;
        }
        const payloads = await Promise.all(refs.map((ref) => api(`/api/raw?file=${encodeURIComponent(ref.file)}&line=${encodeURIComponent(ref.line)}`)));
        if (state.detailSelectionKey !== rawKey) return;
        renderDetailShell({
          title: t("rawRefs"),
          subtitle: rawRefsSubtitle(event),
          actions: [renderReadFromHereAction(), `<button class="smallBtn" type="button" data-detail-action="inspect">${escapeHtml(t("inspectEvent"))}</button>`].filter(Boolean).join(""),
          body: `<div class="rawRefsView">
    <p class="rawMeta">${escapeHtml(t("rawRowsForEvent", { count: refs.length, plural: refs.length === 1 ? "" : "s", eventId: event.id }))}</p>
    ${payloads.map((raw) => `<section class="inspectorSection"><p class="rawMeta">${escapeHtml(raw.file)}:${raw.line}</p><pre>${escapeHtml(JSON.stringify(raw.parsed, null, 2) || raw.raw)}</pre></section>`).join("")}
  </div>`
        });
      }
      function ensureProfileDraft() {
        if (!state.profileDraft) resetProfileDraft();
        state.profileDraft.rules = normalizeRules(state.profileDraft.rules || defaultRules());
      }
      function setProfileId(profileId, options = {}) {
        state.profileId = profileId;
        localStorage.setItem("sessionAnalyzer.profile", state.profileId);
        el.profileSelect.value = state.profileId;
        resetProfileDraft();
        syncProfileInfoSlot();
        clearCurrentSessionOverrides();
        renderTimeline();
        updateMetricActionStates();
        if (!options.keepScroll) resetTimelineScroll();
        if (state.detailView.type === "profileRules") renderProfileRulesPane();
      }
      async function changeProfile(profileId) {
        if (!state.profiles.some((profile) => profile.id === profileId)) return false;
        if (profileId === state.profileId) return true;
        const focusAnchor = captureFocusAnchor();
        if (profileDirty() && !await resolveDirtyProfileBeforeSwitch(profileId)) {
          el.profileSelect.value = state.profileId;
          renderProfileRulesPane();
          return false;
        }
        setProfileId(profileId, { keepScroll: true });
        await restoreFocus(focusAnchor);
        return true;
      }
      async function resolveDirtyProfileBeforeSwitch(targetProfileId) {
        const result = await dirtyProfileSwitchChoice(targetProfileId);
        const choice = result.choice;
        if (choice === "cancel") return false;
        if (choice === "discard") return true;
        if (choice === "save") {
          saveProfileDraft(result.name);
          return true;
        }
        return false;
      }
      function dirtyProfileSwitchChoice(targetProfileId) {
        if (state.dirtyProfileDecisionPending) return state.dirtyProfileDecisionPending;
        if (!el.dirtyProfileDialog) return Promise.resolve({ choice: "cancel", name: "" });
        state.dirtyProfileDecisionPending = new Promise((resolve) => {
          const previousFocus = document.activeElement;
          const currentProfile = activeProfile();
          const defaultName = isBuiltinProfile(state.profileId) ? nextCustomProfileName(state.profileId) : currentProfile.name;
          if (el.dirtyProfileCurrentName) el.dirtyProfileCurrentName.textContent = currentProfile.name;
          if (el.dirtyProfileSaveName) el.dirtyProfileSaveName.value = defaultName;
          const finish = (choice) => {
            el.dirtyProfileDialog.hidden = true;
            el.dirtyProfileDialog.removeEventListener("click", onClick);
            document.removeEventListener("keydown", onKeydown);
            state.dirtyProfileDecisionPending = null;
            if (previousFocus?.focus) previousFocus.focus();
            resolve({ choice, name: el.dirtyProfileSaveName?.value.trim() || defaultName });
          };
          const onClick = (event) => {
            const choice = event.target.closest("[data-dirty-profile-choice]")?.dataset.dirtyProfileChoice;
            if (choice) finish(choice);
          };
          const onKeydown = (event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              finish("cancel");
              return;
            }
            if (event.key === "Enter" && event.target === el.dirtyProfileSaveName) {
              event.preventDefault();
              finish("save");
            }
          };
          el.dirtyProfileDialog.hidden = false;
          el.dirtyProfileDialog.addEventListener("click", onClick);
          document.addEventListener("keydown", onKeydown);
          el.dirtyProfileSaveName?.focus();
          el.dirtyProfileSaveName?.select();
        });
        return state.dirtyProfileDecisionPending;
      }
      function nextCustomProfileName(baseProfileId) {
        const base = state.builtinProfiles.find((profile) => profile.id === baseProfileId) || state.profiles.find((profile) => profile.id === baseProfileId) || activeProfile();
        const count = state.customProfiles.filter((profile) => profile.baseProfileId === baseProfileId).length + 1;
        return t("customProfileName", { name: base.name, count });
      }
      function saveProfileDraft(name = "") {
        ensureProfileDraft();
        const draft = normalizeProfiles([state.profileDraft])[0];
        if (isBuiltinProfile(state.profileId)) {
          const baseProfileId = state.profileId;
          const saved = {
            ...draft,
            id: `custom:${Date.now()}`,
            baseProfileId,
            name: String(name || "").trim() || nextCustomProfileName(baseProfileId),
            description: `Custom strategy based on ${activeProfile().name}`
          };
          state.customProfiles.push(saved);
          saveCustomProfiles();
          state.profileId = saved.id;
        } else {
          state.customProfiles = state.customProfiles.map((profile) => profile.id === state.profileId ? { ...draft, id: state.profileId, name: String(name || "").trim() || profile.name, baseProfileId: profile.baseProfileId } : profile);
          saveCustomProfiles();
        }
        localStorage.setItem("sessionAnalyzer.profile", state.profileId);
        el.profileSelect.innerHTML = renderProfileOptions();
        el.profileSelect.value = state.profileId;
        syncProfileInfoSlot();
        resetProfileDraft();
        clearCurrentSessionOverrides();
        renderTimeline();
        renderProfileRulesPane();
      }
      function cancelProfileDraft() {
        resetProfileDraft();
        renderTimeline();
        renderProfileRulesPane();
      }
      el.projectList?.addEventListener("click", (event) => {
        const item = event.target.closest("[data-project-root]");
        if (item) selectProject(item.dataset.projectRoot).catch(showError);
      });
      el.projectSwitchControl?.addEventListener("click", () => {
        if (state.projectLoadingRoot || state.projectJobId) return;
        const action = state.selectingProject && state.repoRoot ? exitProjectChooser : showProjectChooser;
        action({ autoRestore: false }).catch(showError);
      });
      el.localeSelect?.addEventListener("change", () => {
        changeLocale(el.localeSelect.value).catch(showError);
      });
      el.projectCancelBtn?.addEventListener("click", () => {
        const jobId = state.projectJobId;
        if (!jobId) return;
        clearProjectPollTimer();
        api(`/api/project/status?jobId=${encodeURIComponent(jobId)}`, { method: "DELETE" }).then((data) => handleProjectJobResponse(data)).catch((error) => handleProjectJobError(jobId, error));
      });
      el.sessionList.addEventListener("click", (event) => {
        const item = event.target.closest("[data-session-id]");
        if (item) selectSession(item.dataset.sessionId, { mobileView: "events" }).catch(showError);
      });
      el.sessionList.addEventListener("pointerover", (event) => {
        const item = event.target.closest("[data-parent-session-id]");
        if (item && el.sessionList.contains(item)) setRelatedParentHighlight(item.dataset.parentSessionId, true);
      });
      el.sessionList.addEventListener("pointerout", (event) => {
        const item = event.target.closest("[data-parent-session-id]");
        if (!item || !el.sessionList.contains(item)) return;
        if (item.contains(event.relatedTarget)) return;
        setRelatedParentHighlight(item.dataset.parentSessionId, false);
      });
      el.sessionList.addEventListener("focusin", (event) => {
        const item = event.target.closest("[data-parent-session-id]");
        if (item && el.sessionList.contains(item)) setRelatedParentHighlight(item.dataset.parentSessionId, true);
      });
      el.sessionList.addEventListener("focusout", (event) => {
        const item = event.target.closest("[data-parent-session-id]");
        if (!item || !el.sessionList.contains(item)) return;
        setRelatedParentHighlight(item.dataset.parentSessionId, false);
      });
      for (const button of el.mobileViewButtons) {
        button.addEventListener("click", () => setMobileView(button.dataset.mobileView));
      }
      el.timeline.addEventListener("click", (event) => {
        const article = event.target.closest("[data-event-id]");
        if (!article) return;
        hideSearchAssist();
        const item = state.currentEvents.find((candidate) => candidate.id === article.dataset.eventId);
        if (!item) return;
        const action = event.target.closest("[data-action]")?.dataset.action || "inspect";
        if (action === "toggle") {
          const next = article.classList.contains("expanded") ? foldedDisplayState(item) : "expanded";
          setOverride(item.id, next);
          renderTimeline();
          if (next === "expanded") ensureEventDetail(item);
        } else if (action === "retry-detail") {
          const key = detailKey(state.selectedSessionId, activeLayerId(), item.id);
          delete state.detailErrors[key];
          delete state.detailCache[key];
          ensureEventDetail(item);
        } else if (action === "raw") {
          showRaw(item).catch(showError);
        } else {
          if (!article.classList.contains("expanded")) {
            setOverride(item.id, "expanded");
            renderTimeline();
            ensureEventDetail(item);
          }
          showInspector(item);
        }
      });
      function showImagePreviewError(event) {
        const image = event.target.closest?.(".imagePreviewGrid img");
        if (!image) return;
        image.closest("figure")?.classList.add("failed");
      }
      el.timeline.addEventListener("error", showImagePreviewError, true);
      el.detail.addEventListener("error", showImagePreviewError, true);
      el.detail.addEventListener("click", (event) => {
        const action = event.target.closest("[data-detail-action]")?.dataset.detailAction;
        if (!action) return;
        if (action === "back") {
          backDetailView();
          return;
        }
        if (action === "close") {
          closeDetailView();
          return;
        }
        if (action === "save-profile") {
          saveProfileDraft();
          return;
        }
        if (action === "cancel-profile") {
          cancelProfileDraft();
          return;
        }
        if (action === "view-main-layer") {
          changeLayer("main").catch(showError);
          return;
        }
        if (action === "read-from-here") {
          readFromSelectedEvent().catch(showError);
          return;
        }
        if (action === "navigate-event") {
          navigateSelectedEvent(event.target.closest("[data-nav-direction]")?.dataset.navDirection || "").catch(showError);
          return;
        }
        const key = state.detailSelectionKey.replace(/^raw:/, "");
        const item = state.currentEvents.find((candidate) => detailKey(state.selectedSessionId, activeLayerId(), candidate.id) === key);
        if (!item) return;
        if (action === "inspect") {
          showInspector(item, { replace: true });
        } else if (action === "raw") {
          showRaw(item).catch(showError);
        } else if (action === "retry-detail") {
          delete state.detailErrors[key];
          delete state.detailCache[key];
          showInspector(item, { replace: true });
        }
      });
      el.detail.addEventListener("change", (event) => {
        const profilePicker = event.target.closest("[data-profile-picker]");
        if (profilePicker) {
          changeProfile(profilePicker.value).catch(showError);
          return;
        }
        const fallback = event.target.closest("[data-profile-fallback]");
        if (fallback) {
          ensureProfileDraft();
          state.profileDraft.rules.fallback = fallback.value;
          state.profileDraft.rules = normalizeRules(state.profileDraft.rules);
          renderTimeline();
          renderProfileRulesPane();
          return;
        }
        const kindSelect = event.target.closest("[data-profile-kind]");
        if (kindSelect) {
          ensureProfileDraft();
          const kind = kindSelect.dataset.profileKind;
          if (kindSelect.value) state.profileDraft.rules.kindStates[kind] = kindSelect.value;
          else delete state.profileDraft.rules.kindStates[kind];
          state.profileDraft.rules = normalizeRules(state.profileDraft.rules);
          renderTimeline();
          renderProfileRulesPane();
          return;
        }
        const conditionSelect = event.target.closest("[data-profile-condition]");
        if (conditionSelect) {
          ensureProfileDraft();
          const conditionId = conditionSelect.dataset.profileCondition;
          state.profileDraft.rules.conditions = state.profileDraft.rules.conditions.filter((condition) => condition.id !== conditionId);
          if (conditionSelect.value) state.profileDraft.rules.conditions.push({ id: conditionId, state: conditionSelect.value });
          state.profileDraft.rules = normalizeRules(state.profileDraft.rules);
          renderTimeline();
          renderProfileRulesPane();
          return;
        }
        const select = event.target.closest("[data-navigation-category]");
        if (!select) return;
        state.navigationCategoryId = select.value;
        state.navigationCategoryManualId = select.value;
        const item = currentSelectedEvent();
        if (item) showInspector(item, { replace: true });
      });
      el.profileSelect.addEventListener("change", () => {
        changeProfile(el.profileSelect.value).catch(showError);
      });
      el.layerSelect.addEventListener("change", () => {
        changeLayer(el.layerSelect.value).catch(showError);
      });
      el.resetFoldsBtn.addEventListener("click", () => {
        delete state.overrides[state.selectedSessionId];
        saveOverrides();
        updateResetFoldsButton();
        renderTimeline();
      });
      el.loadMoreBtn.addEventListener("click", () => {
        hideSearchAssist();
        loadTimeline(true).catch(showError);
      });
      el.analysisPanel?.addEventListener("click", (event) => {
        const metricEl = event.target.closest("[data-metric-action]");
        if (!metricEl) return;
        applyMetricAction(metricEl).catch(showError);
      });
      el.analysisPanel?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const metricEl = event.target.closest("[data-metric-action]");
        if (!metricEl) return;
        event.preventDefault();
        applyMetricAction(metricEl).catch(showError);
      });
      el.resultSummary?.addEventListener("click", (event) => {
        const clear = event.target.closest("[data-clear-filter]")?.dataset.clearFilter;
        if (clear) {
          clearActiveFilter(clear);
          return;
        }
        const nav = event.target.closest("[data-search-match-nav]")?.dataset.searchMatchNav;
        if (nav === "previous") {
          hideSearchAssist();
          navigateSearchMatch(-1);
        } else if (nav === "next") {
          hideSearchAssist();
          navigateSearchMatch(1);
        }
      });
      el.searchField?.addEventListener("click", (event) => {
        const nav = event.target.closest("[data-search-match-nav]")?.dataset.searchMatchNav;
        if (nav === "previous") {
          hideSearchAssist();
          navigateSearchMatch(-1);
        } else if (nav === "next") {
          hideSearchAssist();
          navigateSearchMatch(1);
        }
      });
      el.timeline.closest(".timelinePane")?.addEventListener("scroll", onTimelinePaneScroll, { passive: true });
      window.addEventListener("resize", () => {
        queueVisibleDetailLoad();
        syncProfileInfoSlot();
      });
      var reload = debounce(() => {
        syncSearchAssistControls();
        renderSearchAssistChips();
        updateProfileApplicabilityUi();
        if (state.detailView.type === "profileRules") renderProfileRulesPane();
        loadSessions().catch(showError);
      }, 220);
      var refreshFind = debounce(() => {
        refreshTimelineFindState().catch(showError);
      }, SEARCH_HIGHLIGHT_INPUT_DELAY_MS);
      el.searchInput.addEventListener("focus", showSearchAssist);
      el.searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          hideSearchAssist();
          return;
        }
        if (event.key === "Enter") {
          const search = currentSearchState();
          if (search.q) {
            event.preventDefault();
            hideSearchAssist();
            navigateSearchMatch(event.shiftKey ? -1 : 1);
          } else if (!el.searchAssist?.hidden) {
            event.preventDefault();
            hideSearchAssist();
            el.searchInput.blur();
          }
        }
      });
      el.searchInput.addEventListener("input", () => {
        showSearchAssist();
        state.searchTargetPreload = { key: "", pages: 0, pending: false };
        state.searchHighlight = { query: currentSearchState().q, marks: [], activeIndex: -1 };
        state.timelineSearchMatchCount = 0;
        updateSearchMatchControls();
        scheduleSearchHighlightRefresh({ allowPreload: false, syncDetail: true });
        const nextStructureKey = structuredSearchKey();
        const structureChanged = state.searchStructureKey && state.searchStructureKey !== nextStructureKey;
        state.searchStructureKey = nextStructureKey;
        if (structureChanged) {
          refreshFind.cancel();
          reload();
        } else {
          refreshFind();
        }
      });
      el.searchInput.addEventListener("change", () => {
        const nextStructureKey = structuredSearchKey();
        if (nextStructureKey !== state.searchStructureKey) {
          state.searchStructureKey = nextStructureKey;
          refreshFind.cancel();
          reload();
        } else {
          refreshFind();
        }
      });
      el.searchAssist?.addEventListener("click", (event) => {
        const clear = event.target.closest("[data-clear-filter]")?.dataset.clearFilter;
        if (clear) {
          clearActiveFilter(clear);
          return;
        }
        const suggestedFile = event.target.closest("[data-search-file-suggestion]")?.dataset.searchFileSuggestion;
        if (suggestedFile) {
          applySearchOperator("file", suggestedFile);
          hideFileSuggestions();
          return;
        }
      });
      el.searchAssist?.addEventListener("focusin", (event) => {
        if (event.target !== el.searchFileInput) return;
        renderFileSuggestions();
        setFileSuggestionsOpen(true);
      });
      el.searchAssist?.addEventListener("change", (event) => {
        const control = event.target.closest("[data-search-operator]");
        if (!control) return;
        if (control.dataset.searchOperator === "file") hideFileSuggestions();
        applySearchOperator(control.dataset.searchOperator, control.value.trim());
      });
      el.searchAssist?.addEventListener("input", (event) => {
        const control = event.target.closest('[data-search-operator="file"]');
        if (!control) return;
        renderFileSuggestions();
        setFileSuggestionsOpen(true);
        if (isSuggestedFile(control.value)) {
          hideFileSuggestions();
          applySearchOperator("file", control.value.trim());
        }
      });
      el.searchAssist?.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && event.target === el.searchFileInput && !el.searchFileSuggestions?.hidden) {
          event.preventDefault();
          hideFileSuggestions();
          return;
        }
        if (event.key === "ArrowDown" && event.target === el.searchFileInput && !el.searchFileSuggestions?.hidden) {
          const firstSuggestion = el.searchFileSuggestions.querySelector("[data-search-file-suggestion]");
          if (firstSuggestion) {
            event.preventDefault();
            firstSuggestion.focus();
          }
          return;
        }
        if (event.key !== "Enter") return;
        const control = event.target.closest("[data-search-operator]");
        if (!control) return;
        event.preventDefault();
        hideFileSuggestions();
        applySearchOperator(control.dataset.searchOperator, control.value.trim());
      });
      document.addEventListener("pointerdown", (event) => {
        if (el.searchFileInput && !event.target.closest(".fileSuggestControl")) hideFileSuggestions();
        if (!el.searchField || el.searchField.contains(event.target)) return;
        hideSearchAssist();
      });
      el.sortSelect.addEventListener("input", reload);
      el.sortSelect.addEventListener("change", reload);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !el.searchAssist?.hidden) {
          event.preventDefault();
          hideSearchAssist();
          return;
        }
        if (event.altKey && event.key === "ArrowRight") {
          const i = state.profiles.findIndex((profile) => profile.id === state.profileId);
          const next = state.profiles[(i + 1) % state.profiles.length];
          if (next) {
            changeProfile(next.id).catch(showError);
          }
        }
        if (event.altKey && event.key === "ArrowLeft") {
          const i = state.profiles.findIndex((profile) => profile.id === state.profileId);
          const next = state.profiles[(i - 1 + state.profiles.length) % state.profiles.length];
          if (next) {
            changeProfile(next.id).catch(showError);
          }
        }
      });
      function showError(error) {
        if (state.selectingProject) {
          setProjectHeader("", error.message);
        } else {
          el.stateLine.textContent = error.message;
        }
        if (state.selectingProject && el.projectStatus) el.projectStatus.textContent = error.message;
        console.error(error);
      }
      applyStaticLocale();
      init().catch(showError);
    }
  });

  // src/browser/entry.js
  require_command_highlighting();
  require_i18n();
  require_renderers();
  require_search_query();
  require_highlight();
  require_folding();
  require_navigation();
  require_event_chips();
  require_app();
})();
