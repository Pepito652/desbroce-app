-- 1. Crear un esquema privado para extensiones para evitar vulnerabilidades en el esquema public
CREATE SCHEMA IF NOT EXISTS extensions;

-- Mover o instalar PostGIS dentro del esquema extensions
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;

-- 2. Enumeraciones para tipos fijos de operarios y maquinaria
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'tractorista', 'peon', 'conductor');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'machinery_type') THEN
        CREATE TYPE machinery_type AS ENUM ('dumper', 'limpiacunetas', 'tractor', 'vehiculo_transporte', 'otro');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
        CREATE TYPE task_status AS ENUM ('pendiente', 'en_progreso', 'completado', 'incidencia');
    END IF;
END$$;

-- 3. Tabla de Perfiles de Usuario (Extiende auth.users de Supabase)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'peon',
    full_name TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- 4. Equipos de Trabajo
CREATE TABLE IF NOT EXISTS public.work_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- 5. Miembros de Equipos
CREATE TABLE IF NOT EXISTS public.team_members (
    team_id UUID REFERENCES public.work_teams(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (team_id, profile_id)
);

-- 6. Maquinaria
CREATE TABLE IF NOT EXISTS public.machinery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type machinery_type NOT NULL,
    model TEXT,
    license_plate TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- 7. Asignación de Maquinaria a Equipos
CREATE TABLE IF NOT EXISTS public.team_machinery (
    team_id UUID REFERENCES public.work_teams(id) ON DELETE CASCADE,
    machinery_id UUID REFERENCES public.machinery(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (team_id, machinery_id)
);

-- 8. Tramos (Rutas KML)
CREATE TABLE IF NOT EXISTS public.segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    kml_data TEXT,
    status task_status DEFAULT 'pendiente',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- 9. Partes de Trabajo / Asignación de Tramos a Equipos
CREATE TABLE IF NOT EXISTS public.work_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES public.work_teams(id) ON DELETE CASCADE,
    segment_id UUID REFERENCES public.segments(id) ON DELETE CASCADE,
    reported_by UUID REFERENCES public.profiles(id),
    work_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    status task_status DEFAULT 'en_progreso',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- 10. Triggers para actualizar 'updated_at' automáticamente
-- Corrección de advisor: Definir search_path y usar SECURITY INVOKER (por defecto) para evitar riesgos
CREATE OR REPLACE FUNCTION public.update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql' SET search_path = public;

-- Revocar privilegios de ejecución pública para anon y authenticated en esta función
REVOKE EXECUTE ON FUNCTION public.update_modified_column() FROM public;
REVOKE EXECUTE ON FUNCTION public.update_modified_column() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_modified_column() FROM authenticated;

DROP TRIGGER IF EXISTS update_profiles_modtime ON public.profiles;
CREATE TRIGGER update_profiles_modtime BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();

DROP TRIGGER IF EXISTS update_work_teams_modtime ON public.work_teams;
CREATE TRIGGER update_work_teams_modtime BEFORE UPDATE ON public.work_teams FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();

DROP TRIGGER IF EXISTS update_machinery_modtime ON public.machinery;
CREATE TRIGGER update_machinery_modtime BEFORE UPDATE ON public.machinery FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();

DROP TRIGGER IF EXISTS update_segments_modtime ON public.segments;
CREATE TRIGGER update_segments_modtime BEFORE UPDATE ON public.segments FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();

DROP TRIGGER IF EXISTS update_work_logs_modtime ON public.work_logs;
CREATE TRIGGER update_work_logs_modtime BEFORE UPDATE ON public.work_logs FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();

-- Habilitar RLS (Seguridad a Nivel de Fila)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machinery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_machinery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_logs ENABLE ROW LEVEL SECURITY;

-- Políticas de Seguridad Básicas
DROP POLICY IF EXISTS "Lectura general para usuarios autenticados" ON public.profiles;
CREATE POLICY "Lectura general para usuarios autenticados" ON public.profiles FOR SELECT TO authenticated USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "Admin CRUD" ON public.work_teams;
CREATE POLICY "Admin CRUD" ON public.work_teams FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'));
