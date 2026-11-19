CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY
);

CREATE TYPE public.app_role AS ENUM (
  'patient', 'praticien', 'admin'
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT ''
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

CREATE TABLE public.cliniques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL,
  ville text NOT NULL,
  adresse text
);

CREATE TABLE public.praticiens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  nom text NOT NULL,
  specialite text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.praticien_cliniques (
  praticien_id uuid NOT NULL
    REFERENCES public.praticiens(id) ON DELETE CASCADE,
  clinique_id uuid NOT NULL
    REFERENCES public.cliniques(id) ON DELETE CASCADE,
  PRIMARY KEY (praticien_id, clinique_id)
);

CREATE TABLE public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid,
  action text NOT NULL,
  cible text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO auth.users(id) VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');

INSERT INTO public.profiles(id, full_name) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Admin Test'),
  ('10000000-0000-4000-8000-000000000002', 'Compte Test'),
  ('10000000-0000-4000-8000-000000000003', 'Patient Test');

INSERT INTO public.user_roles(user_id, role) VALUES
  ('10000000-0000-4000-8000-000000000001', 'admin'),
  ('10000000-0000-4000-8000-000000000002', 'patient'),
  ('10000000-0000-4000-8000-000000000003', 'patient');

INSERT INTO public.cliniques(id, nom, ville) VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Clinique Test',
    'Sousse'
  );