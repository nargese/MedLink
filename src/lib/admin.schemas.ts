import { z } from "zod";

export const appRoleSchema = z.enum([
  "patient",
  "praticien",
  "admin",
  "super_admin",
]);

export const staffSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z
    .string()
    .min(12)
    .regex(/[A-Z]/)
    .regex(/[a-z]/)
    .regex(/[0-9]/)
    .regex(/[^A-Za-z0-9]/),
  full_name: z.string().trim().min(2).max(100),
  role: appRoleSchema,
  praticien_id: z.guid().optional(),
  specialite: z.string().trim().max(60).optional(),
  cliniques: z.array(z.guid()).max(3).optional(),
});

export const setRoleSchema = z.object({
  user_id: z.string().uuid(),
  role: appRoleSchema,
  action: z.enum(["add", "remove"]),
});