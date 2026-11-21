pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    timeout(time: 30, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '10'))
  }

  environment {
    VITE_SUPABASE_URL = 'https://axkvqstkeewodfjmstme.supabase.co'
    VITE_SUPABASE_PUBLISHABLE_KEY = credentials('medlink-supabase-publishable-key')
  }

  stages {
    stage('Tests Vitest') {
      steps {
        sh '''
          set -eu
          docker run --rm \
            --user "$(id -u):$(id -g)" \
            -e HOME=/tmp \
            -v "$WORKSPACE:/app" \
            -w /app \
            node:22-bookworm-slim \
            sh -ec 'npm ci && npx tsc --noEmit && npm test'
        '''
      }
    }

    stage('Tests SQL et RLS') {
      steps {
        sh '''
          set -eu
          DB_CONTAINER="medlink-sql-${BUILD_NUMBER}"
          echo "$DB_CONTAINER" > .jenkins-sql-container

          docker run -d --name "$DB_CONTAINER" \
            -e POSTGRES_PASSWORD=local-test-only \
            -e POSTGRES_DB=medlink_tests \
            postgres:17

          ready=false
          for attempt in $(seq 1 60); do
            if docker exec "$DB_CONTAINER" \
              pg_isready -U postgres -d medlink_tests; then
              ready=true
              break
            fi
            sleep 2
          done
          if [ "$ready" != true ]; then
            docker logs "$DB_CONTAINER"
            exit 1
          fi

          docker exec "$DB_CONTAINER" mkdir -p /tmp/medlink
          docker cp tests "$DB_CONTAINER:/tmp/medlink/"
          docker cp drizzle "$DB_CONTAINER:/tmp/medlink/"

          docker exec "$DB_CONTAINER" psql \
            -X -v ON_ERROR_STOP=1 -1 \
            -U postgres -d medlink_tests \
            -f /tmp/medlink/tests/sql/bootstrap.sql

          docker exec "$DB_CONTAINER" psql \
            -X -v ON_ERROR_STOP=1 \
            -U postgres -d medlink_tests \
            -f /tmp/medlink/tests/sql/admin-atomic.test.sql

          docker exec "$DB_CONTAINER" createdb \
            -U postgres medlink_rls_tests

          docker exec "$DB_CONTAINER" psql \
            -X -v ON_ERROR_STOP=1 \
            -U postgres -d medlink_rls_tests \
            -f /tmp/medlink/tests/sql/integration-bootstrap.sql

          for test in \
            patient-isolation \
            patient-medical-isolation \
            practitioner-access \
            patient-write-guards \
            practitioner-document-write \
            patient-appointment-tampering \
            super-admin-roles \
            account-finalization-integration \
            suspended-account-access
          do
            docker exec "$DB_CONTAINER" psql \
              -X -v ON_ERROR_STOP=1 \
              -U postgres -d medlink_rls_tests \
              -f "/tmp/medlink/tests/sql/${test}.test.sql"
          done
        '''
      }
    }

    stage('Construction Docker') {
      steps {
        sh '''
          set -eu
          docker build \
            --build-arg VITE_SUPABASE_URL \
            --build-arg VITE_SUPABASE_PUBLISHABLE_KEY \
            -t "medlink:git-${GIT_COMMIT}" .
        '''
      }
    }

    stage('Verification du demarrage') {
      steps {
        sh '''
          set -eu
          APP_CONTAINER="medlink-smoke-${BUILD_NUMBER}"

          cleanup() {
            docker rm -f "$APP_CONTAINER" >/dev/null 2>&1 || true
          }
          trap cleanup EXIT

          docker run -d --name "$APP_CONTAINER" \
            -e SUPABASE_URL="$VITE_SUPABASE_URL" \
            -e SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
            "medlink:git-${GIT_COMMIT}"

          ready=false
          for attempt in $(seq 1 30); do
            if docker exec "$APP_CONTAINER" node -e \
              "fetch('http://127.0.0.1:3000/', {signal: AbortSignal.timeout(3000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
            then
              ready=true
              break
            fi
            sleep 2
          done

          if [ "$ready" != true ]; then
            docker logs --tail 50 "$APP_CONTAINER"
            echo "ECHEC : application indisponible."
            exit 1
          fi

          echo "PASS : application demarree et reponse HTTP valide."
        '''
      }
    }

    stage('Publication Docker Hub') {
      when {
        expression {
          env.GIT_BRANCH == 'origin/integration/imen-nargese' ||
          env.GIT_BRANCH == 'integration/imen-nargese'
        }
      }
      steps {
        withCredentials([
          usernamePassword(
            credentialsId: 'dockerhub-medlink',
            usernameVariable: 'DOCKERHUB_USER',
            passwordVariable: 'DOCKERHUB_TOKEN'
          )
        ]) {
          sh '''
            set +x
            set -eu

            export DOCKER_CONFIG="$(mktemp -d)"

            cleanup_registry() {
              rm -rf "$DOCKER_CONFIG"
            }
            trap cleanup_registry EXIT

            printf '%s' "$DOCKERHUB_TOKEN" |
              docker login \
                --username "$DOCKERHUB_USER" \
                --password-stdin

            REMOTE_IMAGE="imenchi/medlink:git-${GIT_COMMIT}"

            docker tag \
              "medlink:git-${GIT_COMMIT}" \
              "$REMOTE_IMAGE"

            docker push "$REMOTE_IMAGE"

            echo "Image publiee : $REMOTE_IMAGE"
          '''
        }
      }
    }

    stage('Deploiement Kubernetes') {
      when {
        expression {
          env.GIT_BRANCH == 'origin/integration/imen-nargese' ||
          env.GIT_BRANCH == 'integration/imen-nargese'
        }
      }
      steps {
        sh '''
          set -eu
          export KUBECONFIG=/var/lib/jenkins/.kube/medlink.json

          kubectl_medlink() {
            /usr/local/bin/k3s kubectl -n medlink "$@"
          }

          IMAGE="docker.io/imenchi/medlink:git-${GIT_COMMIT}"

          PREVIOUS_IMAGE=$(kubectl_medlink get deployment medlink \
            -o jsonpath='{.spec.template.spec.containers[0].image}')

          kubectl_medlink set image deployment/medlink app="$IMAGE"

          if ! kubectl_medlink rollout status deployment/medlink \
            --timeout=300s
          then
            echo "Echec du deploiement : restauration de l'image precedente."
            kubectl_medlink set image deployment/medlink \
              app="$PREVIOUS_IMAGE"
            kubectl_medlink rollout status deployment/medlink \
              --timeout=180s || true
            exit 1
          fi

          curl --fail --silent --show-error \
            --connect-timeout 5 --max-time 20 \
            -o /dev/null http://192.168.33.10:30082/

          echo "PASS : MedLink deploye et accessible sur Kubernetes."
        '''
      }
    }
  }

  post {
    always {
      sh '''
        if [ -f .jenkins-sql-container ]; then
          DB_CONTAINER=$(cat .jenkins-sql-container)
          docker rm -f "$DB_CONTAINER" || true
          rm -f .jenkins-sql-container
        fi
      '''
    }
    success {
      echo 'Tests Vitest, SQL et construction Docker réussis.'
    }
  }
}
