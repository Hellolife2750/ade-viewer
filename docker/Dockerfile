# --- Base ---
ARG OPENJDK_VERSION=17
FROM eclipse-temurin:${OPENJDK_VERSION}

ARG NODEJS_VERSION=20
ARG GRADLE_VERSION=8.13
ARG CORDOVA_VERSION=12.0.0
ARG ANDROID_CMDTOOLS_VERSION=11076708

LABEL maintainer="Hamdi Fourati <contact@hamdifourati.info>"

WORKDIR /opt/src

# --- Environnements ---
ENV JAVA_HOME=/opt/java/openjdk
ENV ANDROID_SDK_ROOT=/usr/local/android-sdk-linux
ENV ANDROID_HOME=${ANDROID_SDK_ROOT}
ENV GRADLE_USER_HOME=/opt/gradle
ENV PATH=$PATH:${ANDROID_SDK_ROOT}/platform-tools:${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:/opt/gradle/bin

# --- Outils de base ---
RUN apt update && apt install -y git curl unzip inotify-tools android-tools-adb

# --- NodeJS ---
RUN curl -sL https://deb.nodesource.com/setup_${NODEJS_VERSION}.x | bash - && \
    apt install -y nodejs

# --- Cordova ---
RUN npm i -g cordova@${CORDOVA_VERSION} cordova-res sass && cordova telemetry off

# --- Gradle ---
RUN curl -sLo /tmp/gradle-${GRADLE_VERSION}-bin.zip https://downloads.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip && \
    unzip -qd /opt /tmp/gradle-${GRADLE_VERSION}-bin.zip && \
    ln -sfn /opt/gradle-${GRADLE_VERSION} /opt/gradle

# --- Android SDK ---
RUN curl -sLo /tmp/commandlinetools.zip https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDTOOLS_VERSION}_latest.zip && \
    mkdir -p ${ANDROID_SDK_ROOT}/cmdline-tools && \
    unzip -qd ${ANDROID_SDK_ROOT}/cmdline-tools/ /tmp/commandlinetools.zip && \
    mv ${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools ${ANDROID_SDK_ROOT}/cmdline-tools/latest

COPY android.packages android.packages

# --- Install SDK packages ---
RUN yes | sdkmanager --package_file=android.packages && yes | sdkmanager --licenses

# --- Ajouter build-tools (zipalign, apksigner) ---
ENV PATH=$PATH:${ANDROID_SDK_ROOT}/build-tools/35.0.0

EXPOSE 8000 3000
