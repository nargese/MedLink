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
            sh -ec 'npm ci && npm test'
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
            -X -v ON_ERROR_STOP=1 -1 \
            -U postgres -d medlink_rls_tests \
            -f /tmp/medlink/tests/sql/rls-bootstrap.sql

          for test in \
            patient-isolation \
            patient-medical-isolation \
            practitioner-access \
            patient-write-guards \
            practitioner-document-write \
            patient-appointment-tampering
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
            -t "medlink:ci-${BUILD_NUMBER}" .
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
