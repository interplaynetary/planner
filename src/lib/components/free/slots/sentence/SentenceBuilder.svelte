<script lang="ts">
	/**
	 * SentenceBuilder - The "Natural Language" interface for Time Patterns.
	 *
	 * Manages a list of "Rules" (Sentences) that are compiled into an AvailabilityWindow.
	 */
	import SmartChip from './SmartChip.svelte';
	import { DAY_OPTIONS, TIME_OPTIONS, MONTH_OPTIONS, WEEK_OPTIONS } from './options';
	import type { AvailabilityWindow, DayOfWeek, TimeRange } from '$lib/utils/time';
    import { slide, fade } from 'svelte/transition';

	// ═══════════════════════════════════════════════════════════════════
	// TYPES
	// ═══════════════════════════════════════════════════════════════════
	
	type RuleId = string;
	
	interface SentenceRule {
		id: RuleId;
		
		// Level 1: Scope
		monthsMode: 'all' | 'custom' | 'summer' | 'winter' | 'q1' | 'q2' | 'q3' | 'q4';
		selectedMonths: number[]; // Used if mode is custom
		
		// Level 2: Frequency (Only active if monthsMode != all usually, but can be generic)
		weeksMode: 'all' | 'custom' | '1st_3rd' | '2nd_4th';
		selectedWeeks: number[];
		
		// Level 3: Rhythm
		daysMode: 'all' | 'weekdays' | 'weekends' | 'custom' | DayOfWeek; // singular day too
		selectedDays: DayOfWeek[];
		
		// Level 4: Time
		timeMode: 'business_hours' | '24_hours' | 'mornings' | 'afternoons' | 'evenings' | 'custom';
		customStartTime: string;
		customEndTime: string;
	}

	interface Props {
		availabilityWindow?: AvailabilityWindow;
		onChange: (window: AvailabilityWindow) => void;
	}

	let { 
		availabilityWindow, 
		onChange 
	} = $props();

	// ═══════════════════════════════════════════════════════════════════
	// STATE
	// ═══════════════════════════════════════════════════════════════════

	let rules = $state<SentenceRule[]>([createDefaultRule()]);

	// ═══════════════════════════════════════════════════════════════════
	// LOGIC
	// ═══════════════════════════════════════════════════════════════════

	function createDefaultRule(): SentenceRule {
		return {
			id: crypto.randomUUID(),
			monthsMode: 'all',
			selectedMonths: [],
			weeksMode: 'all',
			selectedWeeks: [],
			daysMode: 'all',
			selectedDays: [],
			timeMode: 'business_hours',
			customStartTime: '09:00',
			customEndTime: '17:00'
		};
	}

	function addRule() {
		rules = [...rules, createDefaultRule()];
		compile();
	}

	function removeRule(id: string) {
		if (rules.length <= 1) return; // Prevent deleting last rule
		rules = rules.filter(r => r.id !== id);
		compile();
	}

	// ═══════════════════════════════════════════════════════════════════
	// COMPILATION (Rules -> Schema)
	// ═══════════════════════════════════════════════════════════════════

	function compile() {
		// Aggregate all rules into a single AvailabilityWindow.
		// Since our Schema supports deep nesting, but is fundamentally an "OR" of schedules,
		// we can map each Rule to a MonthSchedule (if specific months) or fit it into the best slot.
		
		// Strategy:
		// 1. If a rule applies to ALL months, it goes to `day_schedules` or `time_ranges` root.
		// 2. If a rule applies to specific months, it goes to `month_schedules`.
		
		const window: AvailabilityWindow = {
			month_schedules: [],
			// We will populate these if we find global rules
			day_schedules: [], 
			time_ranges: []
		};

		for (const rule of rules) {
			const timeRanges = resolveTimeRanges(rule);
			const days = resolveDays(rule);
			const weeks = resolveWeeks(rule);
			const months = resolveMonths(rule);

			// Construct the schedule object fragment for this rule
			// Hierarchy: Month -> Week -> Day -> Time
			
			if (months === 'all') {
				// Global Rule.
				if (weeks === 'all') {
					if (days === 'all') {
						// Simplest: Just time ranges
						// BUT `time_ranges` at root implies every day.
						// We merge into checks below.
						window.time_ranges!.push(...timeRanges); 
						// Note: This merging logic is naive for multiple rules. 
						// Ideally we'd keep them separate day_schedules to avoid crossing.
						// Let's use day_schedules for everything except pure time-only defaults.
					} else {
						// Specific Days, All Weeks, All Months
						window.day_schedules!.push({
							days,
							time_ranges: timeRanges
						});
					}
				} else {
					// Specific Weeks, All Months -> Need to flatten?
					// Schema has `week_schedules` at root too!
					if (!window.week_schedules) window.week_schedules = [];
					window.week_schedules.push({
						weeks,
						day_schedules: [{
							days: days === 'all' ? getAllDays() : days,
							time_ranges: timeRanges
						}]
					});
				}
			} else {
				// Specific Months
				for (const month of months) {
					// Check if we already have a schedule for this month
					let mSched = window.month_schedules!.find(m => m.month === month);
					if (!mSched) {
						mSched = { month, day_schedules: [], week_schedules: [] };
						window.month_schedules!.push(mSched);
					}

					if (weeks === 'all') {
						// Add to day_schedules of this month
                        if (!mSched.day_schedules) mSched.day_schedules = [];
						mSched.day_schedules.push({
							days: days === 'all' ? getAllDays() : days,
							time_ranges: timeRanges
						});
					} else {
						// Add to week_schedules of this month
                        if (!mSched.week_schedules) mSched.week_schedules = [];
						mSched.week_schedules.push({
							weeks,
							day_schedules: [{
								days: days === 'all' ? getAllDays() : days,
								time_ranges: timeRanges
							}]
						});
					}
				}
			}
		}

        // Cleanup empty arrays
        if (window.month_schedules?.length === 0) delete window.month_schedules;
        if (window.day_schedules?.length === 0) delete window.day_schedules;
        if (window.week_schedules?.length === 0) delete window.week_schedules;
        if (window.time_ranges?.length === 0) delete window.time_ranges;

		onChange(window);
	}

	// --- Helpers ---

	function resolveTimeRanges(rule: SentenceRule): TimeRange[] {
		if (rule.timeMode === 'custom') {
			return [{ start_time: rule.customStartTime, end_time: rule.customEndTime }];
		}
		if (rule.timeMode === 'business_hours') return [{ start_time: '09:00', end_time: '17:00' }];
		if (rule.timeMode === '24_hours') return [{ start_time: '00:00', end_time: '23:59' }]; // Close enough
		if (rule.timeMode === 'mornings') return [{ start_time: '08:00', end_time: '12:00' }];
		if (rule.timeMode === 'afternoons') return [{ start_time: '13:00', end_time: '17:00' }];
		if (rule.timeMode === 'evenings') return [{ start_time: '18:00', end_time: '22:00' }];
		return [{ start_time: '09:00', end_time: '17:00' }];
	}

	function resolveDays(rule: SentenceRule): DayOfWeek[] | 'all' {
		if (rule.daysMode === 'all') return 'all'; // Implicit "Every Day" if at higher level
        if (rule.daysMode === 'weekdays') return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
        if (rule.daysMode === 'weekends') return ['saturday', 'sunday'];
        if (rule.selectedDays.length > 0) return rule.selectedDays;
        
        // Handle singular day selection from dropdown (e.g. 'mon')
        if (['mon','tue','wed','thu','fri','sat','sun'].includes(rule.daysMode)) {
            const map: Record<string, DayOfWeek> = { 'mon': 'monday', 'tue': 'tuesday', 'wed': 'wednesday', 'thu': 'thursday', 'fri': 'friday', 'sat': 'saturday', 'sun': 'sunday' };
            return [map[rule.daysMode]];
        }
        
        return 'all';
	}
    
    function getAllDays(): DayOfWeek[] {
        return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    }

	function resolveWeeks(rule: SentenceRule): number[] | 'all' {
		if (rule.weeksMode === 'all') return 'all';
        if (rule.weeksMode === '1st_3rd') return [1, 3];
        if (rule.weeksMode === '2nd_4th') return [2, 4];
        if (rule.selectedWeeks.length > 0) return rule.selectedWeeks;
        return 'all';
	}

	function resolveMonths(rule: SentenceRule): number[] | 'all' {
		if (rule.monthsMode === 'all') return 'all';
		if (rule.monthsMode === 'summer') return [6, 7, 8];
		if (rule.monthsMode === 'winter') return [12, 1, 2];
		if (rule.monthsMode === 'q1') return [1, 2, 3];
		if (rule.monthsMode === 'q2') return [4, 5, 6];
		if (rule.monthsMode === 'q3') return [7, 8, 9];
		if (rule.monthsMode === 'q4') return [10, 11, 12];
		return rule.selectedMonths;
	}

</script>

<div class="sentence-builder">
	{#each rules as rule, i (rule.id)}
		<div class="sentence-row" transition:slide>
            <div class="sentence-content">
                <!-- 1. CONDITION (Scope) -->
                {#if rule.monthsMode !== 'all'}
                    <span class="phrase-group">
                        <span class="preposition">In</span>
						<SmartChip 
							bind:value={rule.monthsMode}
							options={MONTH_OPTIONS}
                            layout="layer"
							onChange={() => compile()}
						/>
                        <span class="chevron">›</span>
                    </span>
                {:else}
                    <!-- Hidden trigger to add condition -->
                     <button class="add-condition-btn" onclick={() => { rule.monthsMode = 'summer'; compile(); }}>
                        + in specific months
                     </button>
                {/if}

                <!-- 2. FREQUENCY (Weeks) - Only if Month scope is active or manually added -->
                {#if rule.monthsMode !== 'all' || rule.weeksMode !== 'all'}
                     {#if rule.weeksMode !== 'all'}
                        <span class="phrase-group">
                             <span class="preposition">on</span>
						<SmartChip 
							bind:value={rule.weeksMode}
							options={WEEK_OPTIONS}
                            layout="layer"
							onChange={() => compile()}
						/>
                            <span class="chevron">›</span>
                        </span>
                     {:else}
                         <!-- Small trigger inside month scope? Or just imply all weeks -->
                     {/if}
                {/if}

                <!-- 3. RHYTHM (Days) -->
                <span class="phrase-group">
                    {#if rule.daysMode !== 'all'}<span class="preposition">on</span>{/if}
                    <SmartChip 
                        bind:value={rule.daysMode}
                        options={DAY_OPTIONS}
                        placeholder="Every Day"
                        layout="layer"
                        onChange={() => compile()}
                    />
                </span>

                <!-- 4. TIME -->
                <span class="phrase-group">
                    <span class="separator">•</span>
                    <SmartChip 
                        bind:value={rule.timeMode}
                        options={TIME_OPTIONS}
                        layout="layer"
                        onChange={() => compile()}
                    />
                    
                    {#if rule.timeMode === 'custom'}
                        <!-- Inline Time Inputs for Custom Mode -->
                        <span class="inline-inputs" transition:fade>
                            <input type="time" bind:value={rule.customStartTime} onchange={compile} class="time-input"/>
                             to 
                            <input type="time" bind:value={rule.customEndTime} onchange={compile} class="time-input"/>
                        </span>
                    {/if}
                </span>
            </div>
            
            <div class="row-actions">
                {#if rules.length > 1}
                    <button class="remove-btn" onclick={() => removeRule(rule.id)} title="Remove rule">×</button>
                {/if}
            </div>
		</div>
        
        <!-- Connector for next rule -->
	{/each}
    
    <button class="add-rule-btn" onclick={addRule}>
        + Add Exception / Another Rule
    </button>
</div>

<style>
	.sentence-builder {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-family: var(--font-sans, 'Inter', sans-serif);
		font-size: 0.72rem;
	}

	.sentence-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 5px 6px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.07);
		border-radius: 4px;
		transition: border-color 0.15s;
		position: relative;
	}

	.sentence-row:hover {
		border-color: rgba(124, 58, 237, 0.3);
	}

	.sentence-content {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px;
		color: #e2e8f0;
		line-height: 1.5;
	}

	.phrase-group {
		display: inline-flex;
		align-items: baseline;
		gap: 4px;
	}

	.preposition {
		color: rgba(167, 139, 250, 0.6);
		font-size: 0.68rem;
		font-weight: 500;
	}

	.chevron {
		color: rgba(167, 139, 250, 0.4);
		font-weight: 800;
		font-size: 0.65em;
		margin: 0 1px;
	}

	.separator {
		color: rgba(255, 255, 255, 0.15);
		margin: 0 2px;
	}

	.add-condition-btn {
		opacity: 0;
		transform: translateX(-6px);
		background: none;
		border: none;
		color: rgba(124, 58, 237, 0.8);
		font-size: 0.65rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0 4px;
		transition: all 0.15s;
	}

	.sentence-row:hover .add-condition-btn {
		opacity: 0.7;
		transform: translateX(0);
	}

	.add-condition-btn:hover {
		opacity: 1 !important;
		text-decoration: underline;
	}

	.add-rule-btn {
		align-self: flex-start;
		background: transparent;
		border: 1px dashed rgba(124, 58, 237, 0.35);
		color: rgba(167, 139, 250, 0.6);
		padding: 2px 8px;
		border-radius: 3px;
		font-size: 0.65rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		margin-top: 2px;
	}

	.add-rule-btn:hover {
		border-color: rgba(124, 58, 237, 0.6);
		color: rgba(167, 139, 250, 0.9);
		background: rgba(124, 58, 237, 0.08);
	}

	.remove-btn {
		background: transparent;
		border: none;
		color: rgba(239, 68, 68, 0.6);
		font-size: 0.9rem;
		line-height: 1;
		cursor: pointer;
		opacity: 0;
		padding: 0 3px;
		border-radius: 3px;
		transition: all 0.15s;
	}

	.sentence-row:hover .remove-btn {
		opacity: 0.6;
	}

	.remove-btn:hover {
		opacity: 1 !important;
		background: rgba(239, 68, 68, 0.1);
	}

	.inline-inputs {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.65rem;
	}

	.time-input {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 3px;
		padding: 1px 3px;
		color: #e2e8f0;
		font-family: monospace;
		font-size: 0.65rem;
		color-scheme: dark;
	}
</style>
