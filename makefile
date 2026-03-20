.PHONY: deploy-back deploy-front deploy-all

deploy-back:
	cd backend && gcloud run deploy nodal-api \
		--source . \
		--region us-central1 \
		--allow-unauthenticated \
		--project nodal-4e6a0 \
		--max-instances 10 \
		--memory 512Mi \
		--cpu 1

deploy-front:
	cd frontend && pnpm build
	firebase deploy --only hosting --project nodal-4e6a0

deploy-all: deploy-back deploy-front
