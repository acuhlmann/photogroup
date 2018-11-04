FROM launcher.gcr.io/google/nodejs

# Copy application code.
COPY . /server/

# Install dependencies.
RUN npm --unsafe-perm install