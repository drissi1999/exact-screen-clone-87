-- Role-grant policy tests. Runs in a transaction and rolls back; no data is kept.
\set ON_ERROR_STOP on
BEGIN;
-- fictitious users (no auth account needed: RLS only reads the JWT sub)
INSERT INTO public.tenants(id,name) VALUES ('10000000-0000-0000-0000-00000000000a','Test A'),('10000000-0000-0000-0000-00000000000b','Test B');
INSERT INTO public.profiles(user_id,tenant_id,full_name) VALUES
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','Admin A'),
 ('00000000-0000-0000-0000-00000000000b','10000000-0000-0000-0000-00000000000a','Membre A'),
 ('00000000-0000-0000-0000-00000000000c','10000000-0000-0000-0000-00000000000b','Admin B');
INSERT INTO public.user_roles(user_id,tenant_id,role) VALUES
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','SPSTI_ADMIN'),
 ('00000000-0000-0000-0000-00000000000c','10000000-0000-0000-0000-00000000000b','SPSTI_ADMIN');
CREATE TEMP TABLE t AS SELECT (SELECT tenant_id FROM public.profiles WHERE user_id='00000000-0000-0000-0000-00000000000a') a,
                                (SELECT tenant_id FROM public.profiles WHERE user_id='00000000-0000-0000-0000-00000000000c') b;
GRANT SELECT ON t TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true) $$;
CREATE OR REPLACE FUNCTION pg_temp.try_grant(u uuid, ten uuid, r app_role) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.user_roles(user_id,tenant_id,role) VALUES (u,ten,r); RETURN true;
EXCEPTION WHEN insufficient_privilege THEN RETURN false; END $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond THEN RAISE NOTICE 'PASS %', name; ELSE RAISE EXCEPTION 'FAIL %', name; END IF; END $$;

-- 1. admin cannot self-grant MEDECIN_TRAVAIL
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT pg_temp.try_grant('00000000-0000-0000-0000-00000000000a',(SELECT a FROM t),'MEDECIN_TRAVAIL'),'admin cannot self-grant MEDECIN_TRAVAIL');
SELECT pg_temp.ok(NOT pg_temp.try_grant('00000000-0000-0000-0000-00000000000a',(SELECT a FROM t),'IDEST'),'admin cannot self-grant IDEST');
SELECT pg_temp.ok(NOT pg_temp.try_grant('00000000-0000-0000-0000-00000000000b',(SELECT a FROM t),'MEDECIN_TRAVAIL'),'admin cannot grant MEDECIN_TRAVAIL to member');
SELECT pg_temp.ok(pg_temp.try_grant('00000000-0000-0000-0000-00000000000b',(SELECT a FROM t),'PDP_COORDINATOR'),'admin can grant PDP_COORDINATOR');
SELECT pg_temp.ok(NOT pg_temp.try_grant('00000000-0000-0000-0000-00000000000c',(SELECT b FROM t),'PDP_COORDINATOR'),'admin cannot grant in another tenant');
SELECT pg_temp.ok(NOT pg_temp.try_grant('00000000-0000-0000-0000-00000000000c',(SELECT a FROM t),'PDP_COORDINATOR'),'admin cannot grant to user of another tenant');
SELECT pg_temp.ok(NOT private.can_read_level('MEDICAL'),'admin cannot read MEDICAL');
RESET ROLE;

-- bootstrap (done server-side with the admin client): B becomes médecin référent
INSERT INTO public.user_roles(user_id,tenant_id,role) VALUES ('00000000-0000-0000-0000-00000000000b',(SELECT a FROM t),'MEDECIN_TRAVAIL');

-- 2. médecin of same tenant can grant/revoke IDEST and MEDECIN_TRAVAIL
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.try_grant('00000000-0000-0000-0000-00000000000a',(SELECT a FROM t),'IDEST'),'medecin can grant IDEST');
SELECT pg_temp.ok(private.can_read_level('MEDICAL'),'medecin reads MEDICAL');
WITH d AS (DELETE FROM public.user_roles WHERE user_id='00000000-0000-0000-0000-00000000000a' AND role='IDEST' RETURNING 1)
SELECT pg_temp.ok((SELECT count(*) FROM d)=1,'medecin can revoke IDEST');
SELECT pg_temp.ok(NOT pg_temp.try_grant('00000000-0000-0000-0000-00000000000b',(SELECT a FROM t),'SPSTI_ADMIN'),'medecin (non-admin) cannot grant SPSTI_ADMIN');
RESET ROLE;

-- 3. admin cannot revoke a médecin
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); SET LOCAL ROLE authenticated;
WITH d AS (DELETE FROM public.user_roles WHERE user_id='00000000-0000-0000-0000-00000000000b' AND role='MEDECIN_TRAVAIL' RETURNING 1)
SELECT pg_temp.ok((SELECT count(*) FROM d)=0,'admin cannot revoke MEDECIN_TRAVAIL');
RESET ROLE;

-- 4. roles held in another tenant do not count
INSERT INTO public.user_roles(user_id,tenant_id,role) VALUES ('00000000-0000-0000-0000-00000000000c',(SELECT a FROM t),'MEDECIN_TRAVAIL');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT private.has_role_text('MEDECIN_TRAVAIL'),'role from foreign tenant ignored by has_role_text');
SELECT pg_temp.ok(NOT private.can_read_level('MEDICAL'),'role from foreign tenant ignored by can_read_level');
SELECT pg_temp.ok(NOT pg_temp.try_grant('00000000-0000-0000-0000-00000000000c',(SELECT b FROM t),'IDEST'),'foreign-tenant medecin cannot grant IDEST at home');
RESET ROLE;
ROLLBACK;
