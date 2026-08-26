-- Close the hole the previous migration's revoke did not actually close.
--
-- Caught by `get_advisors` on first apply, not by review.
--
-- `revoke all on all functions ... from anon, authenticated` removed nothing,
-- because neither role ever held a direct grant. Postgres grants EXECUTE on
-- every new function to the PSEUDO-ROLE `PUBLIC`, and anon inherits it from
-- there - so `can_read_profile`, `current_profile_id` and `owns_profile` were
-- all reachable unauthenticated at /rest/v1/rpc/<name>.
--
-- Nothing leaked: for an anonymous caller `auth.uid()` is null, so
-- current_profile_id() returns null and the other two return null/false. But
-- "anon is granted nothing" was the stated rule and it was not true, and the
-- next SECURITY DEFINER function added here might not be so harmless.
--
-- REVOKE FROM PUBLIC, NOT FROM anon. Revoking a privilege from a role that
-- INHERITS it rather than holding it is a no-op that reads like a fix - which
-- is the entire reason this migration exists.

revoke all on all functions in schema public from public;
alter default privileges in schema public revoke all on functions from public;

-- Hand back exactly what the policies need. Trigger functions are deliberately
-- absent: a trigger is invoked by the system, and the calling role needs no
-- EXECUTE privilege on it.
grant execute on function public.current_profile_id()   to authenticated;
grant execute on function public.can_read_profile(uuid) to authenticated;
grant execute on function public.owns_profile(uuid)     to authenticated;
