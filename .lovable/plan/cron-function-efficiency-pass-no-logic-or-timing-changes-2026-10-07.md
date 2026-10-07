# Cron function efficiency pass (no logic or timing changes)

This plan covers the 7 scheduled functions, applied in one migration. Every condition below is copied from the existing filters, so what the jobs do and when they do it stays the same. Only wasted reads and no-op writes are removed.

## Per-function diff

### 1. booking_dispatch_refund_job — no change
- Already exits early when no refunds are pending.
- Makes no updates and reads no config.

### 2. booking_dispatch_release_due
```diff
 begin
+  if not exists (select 1 from bookings where status='confirmed'
+                 and assigned_expert_id is null and deleted_at is null) then
+    return 0;
+  end if;
   _lead := get_ops_num('booking_dispatch_lead_minutes', 60)::int;   -- already once per call
```
- The update already has `and status='confirmed'`, so it only touches rows that change.

### 3. booking_journey_sweeper
```diff
 begin
+  if not exists (select 1 from bookings where deleted_at is null
+                 and status in ('confirmed','accepted','expert_assigned','on_the_way')) then
+    return 0;
+  end if;
   _asap := get_ops_num(...);  ...  -- 6 settings, already read once per call
```
- Customer name lookup: now read only inside branches that actually send an alert, instead of for every row.
- The extra guards are copied from the existing `if` checks, so these updates only run on rows that change:
```diff
- update bookings set no_expert_alert_sent = true where id = b.id;
+ ... where id = b.id and no_expert_alert_sent is not true;
- update bookings set expert_slot_reminder_sent = true where id = b.id;
+ ... where id = b.id and expert_slot_reminder_sent is not true;
- update bookings set onway_alert_sent = true where id = b.id;
+ ... where id = b.id and onway_alert_sent is not true;
- update bookings set status='cancelled', ... where id = b.id;
+ ... where id = b.id and status in ('confirmed','accepted') and assigned_expert_id is null;
- update experts set is_busy = false where id = b.assigned_expert_id;
+ ... where id = b.assigned_expert_id and is_busy is distinct from false;
- update bookings set assigned_expert_id=null, status='accepted', ... where id = b.id;
+ ... where id = b.id and status = 'expert_assigned';
```

### 4. courier_sweeper_tick
- Still calls `courier_sweeper`, `courier_dispatch_refund_job` and `business_slot_tick` as before. Their insides are not in scope.
- Return-payment block: skipped when no return stop is `arrived`. The order's status is now read once instead of twice per inserted event.
```diff
+ if exists (select 1 from courier_order_stops where stop_type='return' and status='arrived') then
    _esc := courier_setting(...);   -- once per call
    for _r in select ... o.status ... loop
-     update courier_orders set needs_ops_attention=true where id=_r.id;
+     update courier_orders set needs_ops_attention=true
+      where id=_r.id and not coalesce(needs_ops_attention,false);
-     values (_r.id, (select status ...), (select status ...), ...)
+     values (_r.id, _r.status, _r.status, ...)
+ end if;
```
- Settlement loop: uses the status already in the loop row instead of reading it again (same condition).

### 5. expand_stale_broadcasts
```diff
 begin
+  if not exists (select 1 from bookings where deleted_at is null and assigned_expert_id is null
+                 and status in ('accepted','confirmed','pending')) then
+    return 0;
+  end if;
   select * into cfg from dispatch_config limit 1;   -- already once per call
```
```diff
- update bookings set current_search_radius_km = _new_radius where id = b.id;
+ ... where id = b.id and current_search_radius_km is distinct from _new_radius;
- update bookings set dispatch_alert_sent = true where id = b.id;
+ ... where id = b.id and dispatch_alert_sent = false;
```
- The bulk "exhausted" update already filters `dispatch_exhausted_at is null`.

### 6. send_completion_reminders
```diff
 BEGIN
+  IF NOT EXISTS (SELECT 1 FROM bookings WHERE status='in_progress' AND reminder_sent=false) THEN
+    RETURN 0;
+  END IF;
- UPDATE bookings SET reminder_sent = true WHERE id = _r.id;
+ ... WHERE id = _r.id AND reminder_sent = false;
```
- Reads no config.

### 7. system_check_no_accept_alerts
```diff
 BEGIN
+  IF NOT EXISTS (SELECT 1 FROM bookings WHERE status IN ('confirmed','accepted')
+     AND assigned_expert_id IS NULL AND deleted_at IS NULL AND broadcast_started_at IS NOT NULL
+     AND COALESCE(dispatch_alert_sent,false)=false) THEN RETURN; END IF;
+  _default := (SELECT COALESCE(no_accept_alert_threshold_seconds,180) FROM dispatch_config LIMIT 1);  -- once
   FOR b IN SELECT bk.id, bk.broadcast_started_at,
-                  bk.zone_id
+                  COALESCE(cfg.no_accept_alert_threshold_seconds, _default, 180) AS threshold
              FROM bookings bk
+             LEFT JOIN zones z ON z.id = bk.zone_id
+             LEFT JOIN dispatch_config cfg ON cfg.city = z.city
   ... per-row zone/config lookups removed ...
```
- The threshold logic is unchanged: city config first, then the first config row, then 180 seconds.
- No updates: `raise_dispatch_alert` is not in scope.

## Safeguards
- Same function signatures, return types, security settings and search_path.
- Early-exit conditions are equal to or wider than each function's own row filter, so they can't skip work that would have happened.
- Cron schedules are not changed.

## After applying
Each function will be run once and the returned counts checked. Expected: `0` or the same results as before, with no errors.
