-- 03: políticas RLS existentes en producción (pg_policies, 2026-10-09).
\set ON_ERROR_STOP on

CREATE POLICY apps_insert_pro ON public.applications AS PERMISSIVE FOR INSERT TO public WITH CHECK (((auth.uid() = professional_id) AND has_role(auth.uid(), 'professional'::app_role)));
CREATE POLICY apps_select_involved ON public.applications AS PERMISSIVE FOR SELECT TO public USING (((professional_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM job_offers o WHERE ((o.id = applications.job_offer_id) AND (o.posted_by = auth.uid())))) OR is_staff(auth.uid())));
CREATE POLICY apps_update_involved ON public.applications AS PERMISSIVE FOR UPDATE TO public USING (((professional_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM job_offers o WHERE ((o.id = applications.job_offer_id) AND (o.posted_by = auth.uid())))) OR is_staff(auth.uid())));

CREATE POLICY audit_select_staff ON public.audit_log AS PERMISSIVE FOR SELECT TO public USING (is_staff(auth.uid()));

CREATE POLICY slots_delete_owner_or_staff ON public.availability_slots AS PERMISSIVE FOR DELETE TO public USING (((auth.uid() = user_id) OR is_staff(auth.uid())));
CREATE POLICY slots_insert_owner ON public.availability_slots AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY slots_select_owner_or_staff ON public.availability_slots AS PERMISSIVE FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR is_staff(auth.uid())));
CREATE POLICY slots_update_owner_or_staff ON public.availability_slots AS PERMISSIVE FOR UPDATE TO public USING (((auth.uid() = user_id) OR is_staff(auth.uid())));

CREATE POLICY ccm_owner_delete ON public.care_circle_members AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = owner_id));
CREATE POLICY ccm_owner_insert ON public.care_circle_members AS PERMISSIVE FOR INSERT TO public WITH CHECK (((auth.uid() = owner_id) AND (status = 'invited'::text) AND (member_id IS NULL)));
CREATE POLICY ccm_owner_select ON public.care_circle_members AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = owner_id) OR (auth.uid() = member_id) OR (lower(invited_email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))));

CREATE POLICY care_favorites_own ON public.care_favorites AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = client_id)) WITH CHECK ((auth.uid() = client_id));

CREATE POLICY care_logs_professional_insert ON public.care_logs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((professional_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM service_bookings sb WHERE ((sb.id = care_logs.booking_id) AND (sb.professional_id = auth.uid()))))));
CREATE POLICY care_logs_read ON public.care_logs AS PERMISSIVE FOR SELECT TO authenticated USING (((professional_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM service_bookings sb WHERE ((sb.id = care_logs.booking_id) AND (sb.client_id = auth.uid())))) OR is_staff(auth.uid())));

CREATE POLICY conv_insert_participants ON public.conversations AS PERMISSIVE FOR INSERT TO public WITH CHECK (((auth.uid() = poster_id) OR (auth.uid() = professional_id)));
CREATE POLICY conv_select_participants ON public.conversations AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = poster_id) OR (auth.uid() = professional_id) OR is_staff(auth.uid())));
CREATE POLICY conv_update_participants ON public.conversations AS PERMISSIVE FOR UPDATE TO public USING (((auth.uid() = poster_id) OR (auth.uid() = professional_id) OR is_staff(auth.uid())));

CREATE POLICY emergency_insert_self ON public.emergency_incidents AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = triggered_by));
CREATE POLICY emergency_select_involved ON public.emergency_incidents AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = triggered_by) OR is_staff(auth.uid()) OR ((booking_id IS NOT NULL) AND (EXISTS ( SELECT 1 FROM service_bookings b WHERE ((b.id = emergency_incidents.booking_id) AND ((b.client_id = auth.uid()) OR (b.professional_id = auth.uid()))))))));
CREATE POLICY emergency_staff_all ON public.emergency_incidents AS PERMISSIVE FOR ALL TO public USING (is_staff(auth.uid()));

CREATE POLICY fn_delete_owner_or_staff ON public.family_needs AS PERMISSIVE FOR DELETE TO authenticated USING (((auth.uid() = family_user_id) OR is_staff(auth.uid())));
CREATE POLICY fn_insert_owner ON public.family_needs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = family_user_id));
CREATE POLICY fn_select_open_for_pros ON public.family_needs AS PERMISSIVE FOR SELECT TO authenticated USING (((status = 'open'::family_need_status) AND has_role(auth.uid(), 'professional'::app_role)));
CREATE POLICY fn_select_owner_or_staff ON public.family_needs AS PERMISSIVE FOR SELECT TO authenticated USING (((auth.uid() = family_user_id) OR is_staff(auth.uid())));
CREATE POLICY fn_update_matched_by_pro ON public.family_needs AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1 FROM slot_proposals sp WHERE ((sp.family_need_id = family_needs.id) AND (sp.professional_id = auth.uid()) AND (sp.status = 'accepted'::slot_proposal_status))))) WITH CHECK (((status = 'matched'::family_need_status) AND (EXISTS ( SELECT 1 FROM slot_proposals sp WHERE ((sp.family_need_id = family_needs.id) AND (sp.professional_id = auth.uid()) AND (sp.status = 'accepted'::slot_proposal_status))))));
CREATE POLICY fn_update_owner_or_staff ON public.family_needs AS PERMISSIVE FOR UPDATE TO authenticated USING (((auth.uid() = family_user_id) OR is_staff(auth.uid()))) WITH CHECK (((auth.uid() = family_user_id) OR is_staff(auth.uid())));

CREATE POLICY fam_insert_self ON public.family_profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY fam_select_self_or_staff ON public.family_profiles AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = user_id) OR is_staff(auth.uid())));
CREATE POLICY fam_staff_all ON public.family_profiles AS PERMISSIVE FOR ALL TO public USING (is_staff(auth.uid()));
CREATE POLICY fam_update_self_or_staff ON public.family_profiles AS PERMISSIVE FOR UPDATE TO public USING (((auth.uid() = user_id) OR is_staff(auth.uid())));

CREATE POLICY inst_insert_self ON public.institution_profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY inst_select_owner_or_staff ON public.institution_profiles AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = user_id) OR is_staff(auth.uid())));
CREATE POLICY inst_staff_all ON public.institution_profiles AS PERMISSIVE FOR ALL TO public USING (is_staff(auth.uid()));
CREATE POLICY inst_update_self ON public.institution_profiles AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

CREATE POLICY offers_delete_owner ON public.job_offers AS PERMISSIVE FOR DELETE TO public USING (((auth.uid() = posted_by) OR is_staff(auth.uid())));
CREATE POLICY offers_insert_owner ON public.job_offers AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = posted_by));
CREATE POLICY offers_select_open_authenticated_or_owner ON public.job_offers AS PERMISSIVE FOR SELECT TO authenticated USING (((status = 'open'::offer_status) OR (posted_by = auth.uid()) OR is_staff(auth.uid())));
CREATE POLICY offers_update_owner ON public.job_offers AS PERMISSIVE FOR UPDATE TO public USING (((auth.uid() = posted_by) OR is_staff(auth.uid())));

CREATE POLICY msg_insert_sender ON public.messages AS PERMISSIVE FOR INSERT TO public WITH CHECK (((auth.uid() = sender_id) AND (EXISTS ( SELECT 1 FROM conversations c WHERE ((c.id = messages.conversation_id) AND ((auth.uid() = c.poster_id) OR (auth.uid() = c.professional_id)))))));
CREATE POLICY msg_select_participants ON public.messages AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM conversations c WHERE ((c.id = messages.conversation_id) AND ((auth.uid() = c.poster_id) OR (auth.uid() = c.professional_id) OR is_staff(auth.uid()))))));

CREATE POLICY mps_select_self_or_staff ON public.mp_subscriptions AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = user_id) OR is_staff(auth.uid())));
CREATE POLICY mps_staff_all ON public.mp_subscriptions AS PERMISSIVE FOR ALL TO public USING (is_staff(auth.uid()));

CREATE POLICY notif_select_self_or_staff ON public.notifications AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = user_id) OR is_staff(auth.uid())));
CREATE POLICY notif_staff_all ON public.notifications AS PERMISSIVE FOR ALL TO public USING (is_staff(auth.uid()));
CREATE POLICY notif_update_self ON public.notifications AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

CREATE POLICY pqrs_insert_anonymous ON public.pqrs_tickets AS PERMISSIVE FOR INSERT TO anon WITH CHECK ((user_id IS NULL));
CREATE POLICY pqrs_insert_authenticated_self ON public.pqrs_tickets AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY pqrs_select_owner_or_staff ON public.pqrs_tickets AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = user_id) OR is_staff(auth.uid())));
CREATE POLICY pqrs_staff_all ON public.pqrs_tickets AS PERMISSIVE FOR ALL TO public USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

CREATE POLICY pro_insert_self ON public.professional_profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY pro_select_owner ON public.professional_profiles AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY pro_select_published_public ON public.professional_profiles AS PERMISSIVE FOR SELECT TO anon, authenticated USING (((COALESCE(published, false) = true) AND (COALESCE(active, true) = true) AND (COALESCE(blocked, false) = false)));
CREATE POLICY pro_staff_all ON public.professional_profiles AS PERMISSIVE FOR ALL TO public USING (is_staff(auth.uid()));
CREATE POLICY pro_update_self ON public.professional_profiles AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

CREATE POLICY profiles_insert_self ON public.profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY profiles_select_involved_counterparts ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1 FROM (applications a JOIN job_offers o ON ((o.id = a.job_offer_id))) WHERE ((a.status = 'accepted'::application_status) AND (((profiles.user_id = a.professional_id) AND (o.posted_by = auth.uid())) OR ((profiles.user_id = o.posted_by) AND (a.professional_id = auth.uid())))))) OR (EXISTS ( SELECT 1 FROM service_bookings b WHERE ((COALESCE(b.status, ''::text) <> ALL (ARRAY['cancelled'::text, 'canceled'::text, 'rejected'::text])) AND (((profiles.user_id = b.professional_id) AND (b.client_id = auth.uid())) OR ((profiles.user_id = b.client_id) AND (b.professional_id = auth.uid()))))))));
CREATE POLICY profiles_select_self_or_staff ON public.profiles AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = user_id) OR is_staff(auth.uid())));
CREATE POLICY profiles_staff_all ON public.profiles AS PERMISSIVE FOR ALL TO public USING (is_staff(auth.uid()));
CREATE POLICY profiles_update_self ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

CREATE POLICY ratings_delete_self ON public.ratings AS PERMISSIVE FOR DELETE TO public USING (((auth.uid() = rater_user_id) OR is_staff(auth.uid())));
CREATE POLICY ratings_insert_self ON public.ratings AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = rater_user_id));
CREATE POLICY ratings_select_involved ON public.ratings AS PERMISSIVE FOR SELECT TO authenticated USING (((auth.uid() = rater_user_id) OR (auth.uid() = rated_user_id) OR is_staff(auth.uid())));
CREATE POLICY ratings_update_self ON public.ratings AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = rater_user_id));

CREATE POLICY bookings_insert_client ON public.service_bookings AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = client_id));
CREATE POLICY bookings_select_circle ON public.service_bookings AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM care_circle_members m WHERE ((m.owner_id = service_bookings.client_id) AND (m.member_id = auth.uid()) AND (m.status = 'accepted'::text) AND m.can_view_services))));
CREATE POLICY bookings_select_involved ON public.service_bookings AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = client_id) OR (auth.uid() = professional_id) OR is_staff(auth.uid())));
CREATE POLICY bookings_update_involved ON public.service_bookings AS PERMISSIVE FOR UPDATE TO public USING (((auth.uid() = client_id) OR (auth.uid() = professional_id) OR is_staff(auth.uid())));

CREATE POLICY srd_insert_own ON public.service_rating_dimensions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = rater_id));
CREATE POLICY srd_select_involved ON public.service_rating_dimensions AS PERMISSIVE FOR SELECT TO public USING ((((auth.uid() = rater_id) OR (auth.uid() = rated_id)) OR is_staff(auth.uid())));

CREATE POLICY service_ratings_insert_rater ON public.service_ratings AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = rater_id));
CREATE POLICY service_ratings_select_participants ON public.service_ratings AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = rater_id) OR (auth.uid() = rated_id) OR is_staff(auth.uid())));
CREATE POLICY service_ratings_update_self ON public.service_ratings AS PERMISSIVE FOR UPDATE TO public USING (((auth.uid() = rater_id) OR is_staff(auth.uid())));

CREATE POLICY sp_delete_owner_or_staff ON public.slot_proposals AS PERMISSIVE FOR DELETE TO authenticated USING (((auth.uid() = family_user_id) OR (auth.uid() = professional_id) OR is_staff(auth.uid())));
CREATE POLICY sp_insert_self ON public.slot_proposals AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((((proposed_by = 'family'::slot_proposal_proposed_by) AND (auth.uid() = family_user_id)) OR ((proposed_by = 'professional'::slot_proposal_proposed_by) AND (auth.uid() = professional_id))));
CREATE POLICY sp_select_involved ON public.slot_proposals AS PERMISSIVE FOR SELECT TO authenticated USING (((auth.uid() = family_user_id) OR (auth.uid() = professional_id) OR is_staff(auth.uid())));
CREATE POLICY sp_update_involved ON public.slot_proposals AS PERMISSIVE FOR UPDATE TO authenticated USING (((auth.uid() = family_user_id) OR (auth.uid() = professional_id) OR is_staff(auth.uid()))) WITH CHECK (((auth.uid() = family_user_id) OR (auth.uid() = professional_id) OR is_staff(auth.uid())));

CREATE POLICY sub_select_self_or_staff ON public.subscriptions AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = user_id) OR is_staff(auth.uid())));
CREATE POLICY sub_staff_all ON public.subscriptions AS PERMISSIVE FOR ALL TO public USING (is_staff(auth.uid()));

CREATE POLICY tracking_insert_pro ON public.tracking_pings AS PERMISSIVE FOR INSERT TO public WITH CHECK (((auth.uid() = professional_id) AND (EXISTS ( SELECT 1 FROM service_bookings b WHERE ((b.id = tracking_pings.booking_id) AND (b.professional_id = auth.uid()))))));
CREATE POLICY tracking_select_involved ON public.tracking_pings AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM service_bookings b WHERE ((b.id = tracking_pings.booking_id) AND ((b.client_id = auth.uid()) OR (b.professional_id = auth.uid()) OR is_staff(auth.uid()))))));

CREATE POLICY user_roles_delete_superadmin_only ON public.user_roles AS RESTRICTIVE FOR DELETE TO authenticated USING (has_role(auth.uid(), 'superadmin'::app_role));
CREATE POLICY user_roles_insert_superadmin_only ON public.user_roles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'superadmin'::app_role));
CREATE POLICY user_roles_select_own ON public.user_roles AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = user_id) OR is_staff(auth.uid())));
CREATE POLICY user_roles_superadmin_all ON public.user_roles AS PERMISSIVE FOR ALL TO public USING (has_role(auth.uid(), 'superadmin'::app_role));
CREATE POLICY user_roles_update_superadmin_only ON public.user_roles AS RESTRICTIVE FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'superadmin'::app_role)) WITH CHECK (has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY public_insert ON public.validation_responses AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY service_full ON public.validation_responses AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'service_role'::text));
CREATE POLICY service_full ON public.validation_otps AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'service_role'::text));
