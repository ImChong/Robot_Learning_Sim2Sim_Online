<template>
  <AmpMobileJoystick
    v-if="showMobileJoystick"
    ref="ampJoystick"
    :disabled="state !== 1"
    :dock-above-mobile-panel="isSmallScreen"
    :labels="ampJoystickLabels"
    :cmd-x="cmdX"
    :cmd-y="cmdY"
    :cmd-yaw="cmdYaw"
    :profile="joystickProfile"
    :show-knockdown="isAmpPolicy"
    :stick-disabled="isMicroduckPolicy && !isMicroduckWalk"
    :state-buttons="microduckJoystickStates"
    @command="onAmpJoystickCommand"
    @knockdown="onKnockdownTest"
    @state="onMicroduckJoystickState"
  />
  <ParkourMobileJoystick
    v-if="showParkourJoystick"
    ref="parkourJoystick"
    :disabled="state !== 1 || parkourLoading"
    :dock-above-mobile-panel="isSmallScreen"
    :labels="parkourJoystickLabels"
    :virtual-keys="parkourVirtualKeys"
    @input="onParkourJoystickInput"
    @pause="onParkourPause"
    @reset-run="onParkourResetRun"
  />
  <div
    id="mujoco-container"
    v-show="!showEmbeddedDemoFrame && !showBfmMobileBlocked"
  ></div>
  <div v-if="showBfmMobileBlocked" class="parkour-frame-wrap bfm-mobile-blocked">
    <div class="bfm-mobile-blocked-inner">
      <h2 class="bfm-mobile-blocked-title">{{ t.bfmMobileBlockedTitle }}</h2>
      <p class="bfm-mobile-blocked-text">{{ t.bfmMobileUnsupported }}</p>
    </div>
  </div>
  <div v-if="showEmbeddedDemoFrame" class="parkour-frame-wrap">
    <iframe
      ref="parkourFrame"
      :key="parkourReloadKey"
      :src="parkourIframeSrc"
      class="parkour-frame"
      :title="embeddedDemoFrameTitle"
      allow="autoplay; fullscreen"
      sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"
      @load="onParkourLoad"
    ></iframe>
  </div>
  <div class="global-alerts">
    <v-alert
      v-if="isSmallScreen"
      v-model="showSmallScreenAlert"
      type="info"
      color="surface"
      variant="flat"
      density="compact"
      closable
      class="notice-alert small-screen-alert"
    >
      {{ t.mobileModeAlert }}
    </v-alert>
    <v-alert
      v-if="isSafari"
      v-model="showSafariAlert"
      type="warning"
      color="surface"
      variant="flat"
      density="compact"
      closable
      class="notice-alert safari-alert"
    >
      {{ t.safariAlert }}
    </v-alert>
  </div>
  <aside
    id="controls-panel"
    ref="mobileControlsPanel"
    tabindex="-1"
    :aria-label="t.panelTitle"
    :class="['controls', {
      'controls-mobile': isSmallScreen,
      'controls-mobile-collapsed': isSmallScreen && isMobileControlsCollapsed,
      'controls-desktop-collapsed': !isSmallScreen && isMobileControlsCollapsed
    }]"
    :style="desktopControlsPanelStyle"
  >
    <v-card
      class="controls-card"
      :class="{ 'controls-card-resizable': !isSmallScreen }"
    >
      <v-card-title :class="['controls-title', { 'controls-title-mobile': isSmallScreen }]">
        <span>{{ t.panelTitle }}</span>
        <v-btn
          size="small"
          variant="text"
          color="primary"
          class="controls-toggle-btn"
          :aria-label="isMobileControlsCollapsed ? t.expandControlPanel : t.collapseControlPanel"
          @click="toggleMobileControls"
        >
          {{ isMobileControlsCollapsed ? t.expand : t.collapse }}
        </v-btn>
      </v-card-title>
      <v-card-text v-show="!isMobileControlsCollapsed" class="py-0 controls-body">
        <div v-if="showExternalSourceLinks" class="training-links">
          <v-btn
            href="https://github.com/ccrpRepo/AMP_mjlab"
            target="_blank"
            rel="noopener noreferrer"
            variant="text"
            size="small"
            color="primary"
          >
            <v-icon icon="ph-github-logo" class="mr-2"></v-icon>
            G1 AMP Walk/Run/Getup training code
          </v-btn>
          <v-btn
            href="https://php-parkour.github.io/index.html"
            target="_blank"
            rel="noopener noreferrer"
            variant="text"
            size="small"
            color="primary"
          >
            <v-icon icon="ph-file-text" class="mr-2"></v-icon>
            G1 Perceptive Parkour paper
          </v-btn>
          <v-btn
            href="https://github.com/Axellwppr/motion_tracking"
            target="_blank"
            rel="noopener noreferrer"
            variant="text"
            size="small"
            color="primary"
          >
            <v-icon icon="ph-github-logo" class="mr-2"></v-icon>
            G1 Tracking training code
          </v-btn>
          <v-btn
            href="https://acodedog.github.io/perceptive-bfm/"
            target="_blank"
            rel="noopener noreferrer"
            variant="text"
            size="small"
            color="primary"
          >
            <v-icon icon="ph-file-text" class="mr-2"></v-icon>
            G1 Perceptive BFM paper
          </v-btn>
        </div>

        <v-divider v-if="showExternalSourceLinks" class="my-2"/>
        <span class="status-name">{{ t.policy }}</span>
        <div v-if="policyDescription" class="text-caption">{{ policyDescription }}</div>
        <v-select
          v-model="currentPolicy"
          :items="policyItems"
          class="mt-2"
          :label="t.selectPolicy"
          :aria-label="t.selectPolicy"
          density="compact"
          hide-details
          item-title="title"
          item-value="value"
          :disabled="state !== 1"
          data-test="policy-select"
          @update:modelValue="onPolicyChange"
        >
          <template #item="{ props: itemProps, item }">
            <v-list-item
              v-bind="itemProps"
              @mouseenter="schedulePolicyPrefetch(item.value)"
              @focus="schedulePolicyPrefetch(item.value)"
              @mouseleave="cancelPolicyPrefetch"
            ></v-list-item>
          </template>
        </v-select>

        <div v-if="isParkourPolicy" class="parkour-controls mt-4">
          <v-alert
            type="info"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            {{ t.parkourHoldW }}
          </v-alert>
          <template v-if="!isSmallScreen">
            <span class="status-name">{{ t.parkourHowToPlay }}</span>
            <div class="parkour-keys mt-2">
              <template v-for="row in parkourControls" :key="row.key">
                <kbd class="parkour-key">{{ row.key }}</kbd>
                <span class="text-caption">{{ row.label }}</span>
              </template>
            </div>
            <div class="text-caption mt-2 text-medium-emphasis">{{ t.parkourKeyboardFocusHint }}</div>
          </template>
          <div class="text-caption mt-2">{{ t.parkourClimbNote }}</div>
          <div v-if="!isSmallScreen" class="text-caption mt-2 text-medium-emphasis">{{ t.parkourSource }}</div>
          <v-btn
            class="mt-3"
            color="secondary"
            variant="tonal"
            block
            size="small"
            data-test="parkour-depth-diagnostic"
            :disabled="state !== 1 || parkourLoading"
            :loading="parkourDepthDiagnosticLoading"
            @click="runParkourDepthDiagnostic"
          >
            {{ t.parkourDepthDiagnostic }}
          </v-btn>
          <div class="text-caption mt-1 text-medium-emphasis">{{ t.parkourDepthDiagnosticHint }}</div>
        </div>

        <div v-if="isBfmPolicy" class="parkour-controls mt-4">
          <v-alert
            type="info"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            {{ t.bfmDesktopHint }}
          </v-alert>
          <span class="status-name">{{ t.bfmModel }}</span>
          <div class="d-flex gap-2 mt-2">
            <v-btn
              size="small"
              :variant="bfmModel === 'pmt' ? 'flat' : 'tonal'"
              :color="bfmModel === 'pmt' ? 'primary' : 'secondary'"
              :disabled="state !== 1 || parkourLoading"
              @click="onBfmModelChange('pmt')"
            >
              {{ t.bfmModelPmt }}
            </v-btn>
            <v-btn
              size="small"
              :variant="bfmModel === 'legacy' ? 'flat' : 'tonal'"
              :color="bfmModel === 'legacy' ? 'primary' : 'secondary'"
              :disabled="state !== 1 || parkourLoading"
              @click="onBfmModelChange('legacy')"
            >
              {{ t.bfmModelLegacy }}
            </v-btn>
          </div>
          <div class="status-legend follow-controls">
            <span class="status-name">{{ t.bfmFps }}</span>
            <span class="text-caption">{{ bfmFpsLabel }}</span>
          </div>
          <div class="status-legend follow-controls mt-2">
            <span class="status-name">{{ t.bfmSimTime }}</span>
            <span class="text-caption">{{ bfmSimTimeLabel }}</span>
          </div>
          <v-divider class="my-3"/>
          <span class="status-name">{{ t.bfmTerrain }}</span>
          <div class="status-legend follow-controls mt-2">
            <span class="status-name">{{ t.bfmTerrainDifficulty }}</span>
            <span class="text-caption">{{ bfmTerrainDifficulty.toFixed(2) }}</span>
          </div>
          <v-slider
            v-model="bfmTerrainDifficulty"
            min="0"
            max="1"
            step="0.05"
            density="compact"
            hide-details
            :aria-label="t.bfmTerrainDifficulty"
          ></v-slider>
          <div class="status-legend follow-controls mt-2">
            <span class="status-name">{{ t.bfmTerrainSeed }}</span>
            <v-text-field
              v-model.number="bfmTerrainSeed"
              type="number"
              density="compact"
              hide-details
              variant="outlined"
              class="bfm-terrain-seed-field"
              :aria-label="t.bfmTerrainSeed"
            ></v-text-field>
          </div>
          <div class="d-flex gap-2 mt-2">
            <v-btn
              size="small"
              variant="tonal"
              color="secondary"
              @click="bfmTerrainRandomize"
            >
              {{ t.bfmTerrainRandomize }}
            </v-btn>
            <v-btn
              size="small"
              color="primary"
              :disabled="state !== 1 || parkourLoading"
              @click="bfmTerrainGenerate"
            >
              {{ t.bfmTerrainGenerate }}
            </v-btn>
          </div>
          <v-divider class="my-3"/>
          <span class="status-name">{{ t.bfmHowToPlay }}</span>
          <div class="parkour-keys mt-2">
            <template v-for="row in bfmControls" :key="row.key">
              <kbd class="parkour-key">{{ row.key }}</kbd>
              <span class="text-caption">{{ row.label }}</span>
            </template>
          </div>
          <div class="text-caption mt-2 text-medium-emphasis">{{ t.bfmFocusHint }}</div>
          <div v-if="!isSmallScreen" class="text-caption mt-2 text-medium-emphasis">{{ t.bfmSource }}</div>
        </div>

        <div v-if="isMicroduckPolicy" class="microduck-controls mt-4">
          <v-btn
            v-if="showExternalSourceLinks"
            href="https://github.com/pollen-robotics/microduck_rl"
            target="_blank"
            rel="noopener noreferrer"
            variant="text"
            size="small"
            color="primary"
            class="mb-2 microduck-source-link"
          >
            <v-icon icon="ph-github-logo" class="mr-2"></v-icon>
            Microduck Sim2Sim training code
          </v-btn>
          <span class="status-name">{{ t.microduckStateMachine }}</span>
          <div class="microduck-state-grid mt-2" role="group" :aria-label="t.microduckStateMachine">
            <v-btn
              v-for="item in microduckStateItems"
              :key="item.value"
              :color="item.active ? 'primary' : 'secondary'"
              :variant="item.active ? 'flat' : 'tonal'"
              size="small"
              :data-test="`microduck-state-${item.value}`"
              :aria-pressed="item.active ? 'true' : 'false'"
              :disabled="state !== 1 || microduckStateSwitching"
              @click="switchMicroduckState(item.value)"
            >
              <v-icon :icon="item.icon" class="mr-1"></v-icon>
              {{ item.title }}
            </v-btn>
          </div>
          <div v-if="microduckStateHint" class="text-caption mt-2">{{ microduckStateHint }}</div>
          <v-btn
            v-if="isMicroduckSitstand"
            class="mt-1"
            color="secondary"
            variant="tonal"
            block
            size="small"
            data-test="microduck-sit-toggle"
            :disabled="state !== 1"
            @click="toggleMicroduckSit"
          >
            {{ microduckSitMode ? t.microduckStandAction : t.microduckSitAction }}
          </v-btn>
          <div v-if="isMicroduckSitstand" class="text-caption mt-1">{{ t.microduckSitHint }}</div>
          <div class="text-caption mt-2 text-medium-emphasis">{{ t.microduckStateSwitchHint }}</div>
          <div v-if="!isSmallScreen && microduckKeyboardControls.length" class="amp-keyboard-controls mt-3">
            <span class="status-name">{{ t.microduckHowToPlay }}</span>
            <div class="parkour-keys mt-2">
              <template v-for="row in microduckKeyboardControls" :key="row.key">
                <kbd class="parkour-key">{{ row.key }}</kbd>
                <span class="text-caption">{{ row.label }}</span>
              </template>
            </div>
            <div class="text-caption mt-2 text-medium-emphasis">{{ t.microduckKeyboardFocusHint }}</div>
          </div>
          <div v-if="!isSmallScreen" class="text-caption mt-2 text-medium-emphasis">{{ t.microduckSource }}</div>
        </div>

        <div v-if="isVelocityCommandPolicy" class="mt-4">
          <div class="status-legend follow-controls mt-2">
            <span class="status-name">{{ t.velocityX }}</span>
            <span class="text-caption">{{ cmdX.toFixed(2) }}</span>
          </div>
          <v-slider
            v-model="cmdX"
            :min="velocityLimits.cmdX.min"
            :max="velocityLimits.cmdX.max"
            :step="velocitySliderStep"
            density="compact"
            hide-details
            :aria-label="t.velocityX"
            @update:modelValue="onCmdChange"
          ></v-slider>
          <div class="status-legend follow-controls mt-2">
            <span class="status-name">{{ t.velocityY }}</span>
            <span class="text-caption">{{ cmdY.toFixed(2) }}</span>
          </div>
          <v-slider
            v-model="cmdY"
            :min="velocityLimits.cmdY.min"
            :max="velocityLimits.cmdY.max"
            :step="velocitySliderStep"
            density="compact"
            hide-details
            :aria-label="t.velocityY"
            @update:modelValue="onCmdChange"
          ></v-slider>
          <div class="status-legend follow-controls mt-2">
            <span class="status-name">{{ t.yawRate }}</span>
            <span class="text-caption">{{ cmdYaw.toFixed(2) }}</span>
          </div>
          <v-slider
            v-model="cmdYaw"
            :min="velocityLimits.cmdYaw.min"
            :max="velocityLimits.cmdYaw.max"
            :step="velocitySliderStep"
            density="compact"
            hide-details
            :aria-label="t.yawRate"
            @update:modelValue="onCmdChange"
          ></v-slider>
          <template v-if="isAmpPolicy">
            <v-btn
              class="mt-3"
              color="secondary"
              variant="tonal"
              block
              size="small"
              data-test="knockdown-test"
              :disabled="state !== 1"
              @click.stop="onKnockdownTest"
            >
              {{ t.knockdownTest }}
            </v-btn>
            <div class="text-caption mt-1">{{ t.knockdownTestHint }}</div>
            <div v-if="!isSmallScreen" class="amp-keyboard-controls mt-3">
              <span class="status-name">{{ t.ampKeyboardHowToPlay }}</span>
              <div class="parkour-keys mt-2">
                <template v-for="row in ampKeyboardControls" :key="row.key">
                  <kbd class="parkour-key">{{ row.key }}</kbd>
                  <span class="text-caption">{{ row.label }}</span>
                </template>
              </div>
              <div class="text-caption mt-2 text-medium-emphasis">{{ t.ampKeyboardFocusHint }}</div>
            </div>
          </template>
        </div>

        <v-alert
          v-if="policyLoadError"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-2"
        >
          {{ policyLoadError }}
        </v-alert>

        <div v-if="isTrackingPolicy" class="status-legend follow-controls mt-2">
          <span class="status-name">{{ t.compliance }}</span>
          <v-btn
            size="x-small"
            variant="tonal"
            color="primary"
            :disabled="state !== 1"
            @click="toggleCompliance"
          >
            {{ complianceEnabled ? t.on : t.off }}
          </v-btn>
          <span class="status-name">{{ t.threshold }}</span>
          <span class="text-caption">{{ complianceThresholdLabel }}</span>
        </div>
        <v-slider
          v-if="isTrackingPolicy"
          v-model="complianceThreshold"
          min="10"
          max="20"
          step="0.1"
          density="compact"
          hide-details
          :aria-label="t.threshold"
          :disabled="state !== 1 || !complianceEnabled"
          @update:modelValue="onComplianceThresholdChange"
        ></v-slider>

        <template v-if="isTrackingPolicy">
        <v-divider class="my-2"/>
        <div class="motion-status" v-if="trackingState" role="status" aria-live="polite">
          <div class="status-legend" v-if="trackingState.available">
            <span class="status-name">{{ t.currentMotion }}: {{ trackingState.currentName }}</span>
          </div>
        </div>

          <v-progress-linear
            v-if="shouldShowProgress"
            :model-value="progressValue"
            height="5"
            color="primary"
            rounded
            class="mt-3 motion-progress-no-animation"
            aria-label="Motion progress"
          ></v-progress-linear>
        <v-alert
          v-if="showBackToDefault"
          type="info"
          variant="tonal"
          density="compact"
          class="mt-3"
        >
          {{ formatMessage(t.motionFinished, { name: trackingState.currentName }) }}
          <v-btn color="primary" block density="compact" @click="backToDefault">
            {{ t.backToDefaultPose }}
          </v-btn>
        </v-alert>

        <v-alert
          v-else-if="showMotionLockedNotice"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-3"
        >
          {{ formatMessage(t.motionLocked, { name: trackingState.currentName }) }}
        </v-alert>

        <div v-if="showMotionSelect" class="motion-groups">
          <div v-for="group in motionGroups" :key="group.title" class="motion-group">
            <span class="status-name motion-group-title">{{ group.title }}</span>
            <v-chip
              v-for="item in group.items"
              :key="item.value"
              :disabled="item.disabled"
              :color="currentMotion === item.value ? 'primary' : undefined"
              :variant="currentMotion === item.value ? 'flat' : 'tonal'"
              class="motion-chip"
              size="x-small"
              role="button"
              :aria-label="item.title"
              @click="onMotionChange(item.value)"
            >
              {{ item.title }}
            </v-chip>
          </div>
        </div>

        <v-alert
          v-else-if="!trackingState.available"
          type="info"
          variant="tonal"
          density="compact"
        >
          {{ t.loadingMotionPresets }}
        </v-alert>

        <v-divider class="my-2"/>
        <div class="upload-section">
          <v-btn
            v-if="!showUploadOptions"
            variant="text"
            density="compact"
            color="primary"
            class="upload-toggle"
            @click="showUploadOptions = true"
          >
            {{ t.useCustomizedMotions }}
          </v-btn>
          <template v-else>
            <span class="status-name">{{ t.customMotions }}</span>
            <v-file-input
              v-model="motionUploadFiles"
              :label="t.uploadMotionJson"
              density="compact"
              hide-details
              accept=".json,application/json"
              prepend-icon="ph-upload-simple"
              multiple
              show-size
              :disabled="state !== 1"
              @update:modelValue="onMotionUpload"
            ></v-file-input>
            <div class="text-caption">
              <span>
                {{ t.motionUploadHelpRead }}
                <a target="_blank" rel="noopener noreferrer" href="https://github.com/Axellwppr/humanoid-policy-viewer?tab=readme-ov-file#add-your-own-robot-policy-and-motions">{{ t.motionUploadHelpLink }}</a>
                {{ t.motionUploadHelpInstructions }}
                <br>
                {{ t.motionUploadHelpDetails }}
              </span>
            </div>
            <v-alert
              v-if="motionUploadMessage"
              :type="motionUploadType"
              variant="tonal"
              density="compact"
            >
              {{ motionUploadMessage }}
            </v-alert>
          </template>
        </div>

        </template>

        <v-divider class="my-2"/>
        <div class="status-legend follow-controls">
          <span class="status-name">{{ t.cameraFollow }}</span>
          <v-btn
            size="x-small"
            variant="tonal"
            color="primary"
            :disabled="state !== 1"
            @click="toggleCameraFollow"
          >
            {{ cameraFollowEnabled ? t.on : t.off }}
          </v-btn>
        </div>
        <div class="status-legend follow-controls mt-2">
          <span class="status-name">{{ t.simFreq }}</span>
          <span class="text-caption">{{ simStepLabel }}</span>
        </div>
        <div class="status-legend follow-controls mt-2">
          <span class="status-name">{{ t.renderScale }}</span>
          <span class="text-caption">{{ renderScaleLabel }}</span>
        </div>
        <v-slider
          v-model="renderScale"
          min="0.5"
          max="2.0"
          step="0.1"
          density="compact"
          hide-details
          :aria-label="t.renderScale"
          @update:modelValue="onRenderScaleChange"
        ></v-slider>
        <div class="status-legend follow-controls mt-2">
          <span class="status-name">{{ t.groundReflection }}</span>
          <span class="text-caption">{{ reflectionQualityLabel }}</span>
        </div>
        <v-slider
          v-model="reflectionQuality"
          min="0"
          max="4"
          step="1"
          density="compact"
          hide-details
          :aria-label="t.groundReflection"
          @update:modelValue="onReflectionQualityChange"
        ></v-slider>
      </v-card-text>
      <v-card-actions class="controls-actions">
        <v-btn color="primary" block @click="reset">{{ isExternalDemoPolicy ? (isParkourPolicy ? t.parkourReset : t.bfmReset) : t.reset }}</v-btn>
      </v-card-actions>

      <template v-if="!isSmallScreen && !isMobileControlsCollapsed">
        <div
          class="controls-resize-handle controls-resize-w"
          role="separator"
          :aria-label="t.resizeControlWidth"
          @mousedown.prevent="startControlPanelResize('w', $event)"
        />
        <div
          class="controls-resize-handle controls-resize-s"
          role="separator"
          :aria-label="t.resizeControlHeight"
          @mousedown.prevent="startControlPanelResize('s', $event)"
        />
        <div
          class="controls-resize-handle controls-resize-sw"
          role="separator"
          :aria-label="t.resizeControlBoth"
          @mousedown.prevent="startControlPanelResize('sw', $event)"
        />
      </template>
    </v-card>
  </aside>
  <v-dialog
    :model-value="showSimulationLoadingDialog"
    persistent
    max-width="600px"
    scrollable
    class="loading-simulation-dialog"
  >
    <v-card :title="t.loadingSimulationTitle">
      <v-card-text>
        <p class="text-body-2 mb-3">{{ t.loadingSimulationBody }}</p>
        <v-progress-linear
          :model-value="simulationLoadingProgress"
          height="10"
          color="primary"
          rounded
          class="loading-simulation-progress"
          :aria-label="t.loadingSimulationTitle"
          :aria-valuenow="simulationLoadingProgress"
          aria-valuemin="0"
          aria-valuemax="100"
          role="progressbar"
        ></v-progress-linear>
        <div class="text-caption text-medium-emphasis mt-2 text-end">{{ simulationLoadingProgress }}%</div>
      </v-card-text>
    </v-card>
  </v-dialog>
  <ModelIOFlowchart
    v-if="!isExternalDemoPolicy"
    :demo="demo"
    :ready="state === 1"
    :language="language"
    :is-small-screen="isSmallScreen"
    :mobile-controls-collapsed="isMobileControlsCollapsed"
  />
  <v-dialog :model-value="state < 0" persistent max-width="600px" scrollable>
    <v-card :title="t.loadingErrorTitle">
      <v-card-text>
        <span v-if="state === -1">
          {{ t.runtimeError }}<br />
          {{ extra_error_message }}
        </span>
        <span v-else-if="state === -2">
          {{ t.webAssemblyUnsupported }}
        </span>
      </v-card-text>
    </v-card>
  </v-dialog>
  <v-dialog
    v-model="parkourDepthDiagnosticOpen"
    max-width="640"
    scrollable
    class="parkour-depth-diagnostic-dialog"
  >
    <v-card :title="t.parkourDepthDiagnosticTitle">
      <v-card-text>
        <v-alert
          v-if="parkourDepthDiagnosticSummary"
          :type="parkourDepthDiagnosticSummary.type"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ parkourDepthDiagnosticSummary.text }}
        </v-alert>
        <ul v-if="parkourDepthDiagnosticHintLines.length" class="parkour-depth-diagnostic-hints mb-3">
          <li
            v-for="hint in parkourDepthDiagnosticHintLines"
            :key="hint"
            class="text-caption"
          >
            {{ hint }}
          </li>
        </ul>
        <v-textarea
          :model-value="parkourDepthDiagnosticText"
          readonly
          auto-grow
          rows="12"
          variant="outlined"
          density="compact"
          class="parkour-depth-diagnostic-text"
          :aria-label="t.parkourDepthDiagnosticTitle"
        />
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" @click="parkourDepthDiagnosticOpen = false">
          {{ t.parkourDepthDiagnosticClose }}
        </v-btn>
        <v-spacer />
        <v-btn color="primary" @click="copyParkourDepthDiagnostic">
          {{
            parkourDepthDiagnosticCopied
              ? t.parkourDepthDiagnosticCopied
              : t.parkourDepthDiagnosticCopy
          }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
import { markRaw } from 'vue';
import ModelIOFlowchart from '@/components/ModelIOFlowchart.vue';
import AmpMobileJoystick from '@/components/AmpMobileJoystick.vue';
import ParkourMobileJoystick from '@/components/ParkourMobileJoystick.vue';
import { showExternalSourceLinks } from '@/config/siteLinks.js';
import {
  clampControlPanelSize,
  loadControlPanelSize,
  saveControlPanelSize
} from '@/utils/controlPanelSize.js';
import {
  AMP_CMD_LIMITS,
  AMP_KEYBOARD_CONTROL_ROWS,
  computeAmpCommandFromKeys,
  isAmpKnockdownKey,
  isAmpMovementKey,
  shouldIgnoreAmpKeyboardTarget
} from '@/utils/ampKeyboardCommand.js';
import {
  MICRODUCK_CMD_LIMITS,
  MICRODUCK_JOYSTICK_PROFILE,
  MICRODUCK_KEYBOARD_CONTROL_ROWS,
  computeMicroduckCommandFromKeys,
  isMicroduckMovementKey,
  isMicroduckSitKey
} from '@/utils/microduckKeyboardCommand.js';
import {
  MICRODUCK_AUTO_NEXT_POLL_MS,
  MICRODUCK_DEFAULT_STATE,
  MICRODUCK_POLICY_VALUE,
  MICRODUCK_SCENE_PATH,
  MICRODUCK_STATES,
  findMicroduckState,
  microduckDefaultPolicyPaths,
  microduckStateOrDefault
} from '@/utils/microduckStateMachine.js';
import { AMP_JOYSTICK_PROFILE } from '@/utils/ampJoystickCommand.js';
import {
  MICRODUCK_UNLOCK_CODE,
  isPolicyUnlocked,
  resolveUnlockedPolicyCodes
} from '@/utils/hiddenPolicyUnlock.js';
import {
  computeParkourMobileDepthLayout,
  computeParkourMobileDepthLayoutFromMetrics,
  computeParkourMobileDepthLayoutWithClearance
} from '@/utils/parkourDepthPreviewLayout.js';
import {
  isParkourMovementKey,
  isParkourPauseKey,
  isParkourResetKey,
  parkourVirtualKeysFromKeyboard
} from '@/utils/parkourKeyboardCommand.js';
import {
  buildParkourDepthDiagnosticReport,
  fetchParkourBundleIosPatchStatus,
  formatParkourDepthDiagnosticReport
} from '@/utils/parkourDepthDiagnostic.js';
import {
  isAppleMobileDevice,
  isBfmDesktopRequired,
  PARKOUR_IOS_MOUNT_DELAY_MS
} from '@/utils/appleMobile.js';
import {
  consumeIosBootPolicy,
  scheduleIosPolicyBoot
} from '@/utils/iosPolicyBoot.js';

// 鼠标在策略下拉项上停留这么久才预取，快速划过时不浪费流量。
const POLICY_PREFETCH_DELAY_MS = 100;

const translations = {
  en: {
    mobileModeAlert: 'Mobile layout: the control panel is docked at the bottom for touch input.',
    safariAlert: 'Safari has lower memory limits, so the WebAssembly simulation may crash.',
    panelTitle: 'General tracking demo',
    expandControlPanel: 'Expand control panel',
    collapseControlPanel: 'Collapse control panel',
    expand: 'Expand',
    collapse: 'Collapse',
    trainingCode: 'Training code',
    policy: 'Policy',
    selectPolicy: 'Select policy',
    compliance: 'Compliance',
    threshold: 'threshold',
    on: 'On',
    off: 'Off',
    currentMotion: 'Current motion',
    motionFinished: 'Motion "{name}" finished. Return to the default pose before starting another clip.',
    backToDefaultPose: 'Back to default pose',
    motionLocked: '"{name}" is still playing. Wait until it finishes and returns to default pose before switching.',
    loadingMotionPresets: 'Loading motion presets…',
    useCustomizedMotions: 'Want to use customized motions?',
    customMotions: 'Custom motions',
    uploadMotionJson: 'Upload motion JSON',
    motionUploadHelpRead: 'Read ',
    motionUploadHelpLink: 'readme',
    motionUploadHelpInstructions: ' to learn how to create motion JSON files from GMR.',
    motionUploadHelpDetails: 'Each file should be a single clip (same schema as motions/default.json). File name becomes the motion name (prefixed with [new]). Duplicate names are ignored.',
    cameraFollow: 'Camera follow',
    velocityX: 'Velocity X',
    velocityY: 'Velocity Y',
    yawRate: 'Yaw rate',
    renderScale: 'Render scale',
    groundReflection: 'Ground reflection',
    simFreq: 'Sim frequency',
    reset: 'Reset',
    loadingSimulationTitle: 'Loading Simulation Environment',
    loadingSimulationBody: 'Loading MuJoCo and ONNX policy, please wait',
    loadingErrorTitle: 'The simulation failed to load',
    runtimeError: 'Unexpected runtime error, please refresh the page.',
    webAssemblyUnsupported: 'Your browser does not support WebAssembly. Please use a recent version of Chrome, Edge, or Firefox.',
    policyDescription: 'Tracking policy with compliance input enabled.',
    customizedGroup: 'Customized',
    demoNotReady: 'Demo not ready yet. Please wait for loading to finish.',
    addedMotions: 'Added {count} motion{plural}',
    skippedDuplicates: 'Skipped {count} duplicate{plural}',
    ignoredInvalid: 'Ignored {count} invalid file{plural}',
    noMotionsAdded: 'No motions were added.',
    knockdownTest: 'Knockdown test',
    knockdownTestHint: 'Applies a strong horizontal impulse on the pelvis in a random XY direction (fixed magnitude) for get-up testing.',
    ampKeyboardHowToPlay: 'PC keyboard (AMP)',
    ampKeyForward: 'Walk forward',
    ampKeyBackward: 'Walk backward',
    ampKeyLeft: 'Strafe left',
    ampKeyRight: 'Strafe right',
    ampKeyRotateLeft: 'Turn in place left',
    ampKeyRotateRight: 'Turn in place right',
    ampKeySprint: 'Hold for maximum speed',
    ampKeyKnockdown: 'Knockdown test',
    ampKeyboardFocusHint: 'Click the demo view first, then use the keys. Sliders update while keys are held.',
    ampJoystickGroup: 'AMP movement controls',
    microduckJoystickGroup: 'Microduck movement and state controls',
    ampJoystickMove: 'Move (up/down = forward/back, left/right = turn in place)',
    ampJoystickStrafeLeft: 'Strafe left',
    ampJoystickStrafeRight: 'Strafe right',
    parkourJoystickGroup: 'Parkour movement controls',
    parkourJoystickMove: 'Move (up = forward, left/right = turn in place, no backward)',
    parkourJoystickPause: 'Pause',
    parkourJoystickResetRun: 'Reset run',
    ampPolicyDescription:
      'AMP policy trained for walk, run, and get-up behaviors.',
    parkourPolicyDescription:
      'Perceptive humanoid parkour demo (embedded). Drive the G1 over the terrain course with the keyboard.',
    parkourHoldW:
      'Keep holding W during approach, climbing, on top, and descent, until you are back on the ground.',
    parkourHowToPlay: 'How to play',
    parkourMoveForward: 'Move forward',
    parkourTurnLeft: 'Turn left',
    parkourTurnRight: 'Turn right',
    parkourSpeed: 'Toggle speed mode',
    parkourPause: 'Pause',
    parkourResetRun: 'Reset run',
    parkourClimbNote: 'Climbing engages automatically while you hold W.',
    parkourFocusHint: 'Click the demo view first, then use the keys.',
    parkourKeyboardFocusHint: 'Use WASD and Shift on the keyboard; the joystick knob follows while keys are held.',
    parkourSource: 'Embedded build from php-parkour, self-hosted in this site.',
    parkourDepthDiagnostic: 'Depth diagnostic',
    parkourDepthDiagnosticHint:
      'Exports depth pipeline status (iOS readback, policy, preview brightness) as JSON for debugging.',
    parkourDepthDiagnosticTitle: 'Parkour depth diagnostic',
    parkourDepthDiagnosticCopy: 'Copy report',
    parkourDepthDiagnosticCopied: 'Copied',
    parkourDepthDiagnosticClose: 'Close',
    parkourDepthDiagnosticHealthy: 'Depth preview and readback look healthy.',
    parkourReset: 'Restart run',
    bfmPolicyDescription:
      'Perceptive Behavior Foundation Model demo (embedded). Switch motion references and watch terrain-aware tracking in the browser.',
    bfmDesktopHint:
      'Terrain and telemetry live in this control panel. Motion buttons stay in the demo view at the bottom.',
    bfmModel: 'Robot model',
    bfmModelPmt: 'PMT-faithful',
    bfmModelLegacy: 'Legacy',
    bfmFps: 'Render FPS',
    bfmSimTime: 'Sim time',
    bfmTerrain: 'Terrain',
    bfmTerrainDifficulty: 'Difficulty',
    bfmTerrainSeed: 'Seed',
    bfmTerrainRandomize: 'Randomize seed',
    bfmTerrainGenerate: 'Generate terrain',
    bfmHowToPlay: 'How to play',
    bfmMoveForward: 'Move forward',
    bfmMoveBackward: 'Move backward',
    bfmStrafeLeft: 'Strafe left',
    bfmStrafeRight: 'Strafe right',
    bfmTurnLeft: 'Turn left',
    bfmTurnRight: 'Turn right',
    bfmStop: 'Stop / balance',
    bfmPause: 'Pause / resume',
    bfmReset: 'Restart demo',
    bfmResetSim: 'Reset simulation',
    bfmHeightScan: 'Toggle height scan viz',
    bfmFocusHint: 'Click the demo view first, then use the keyboard or motion buttons in the embedded HUD.',
    bfmSource: 'Embedded build from acodedog.github.io/perceptive-bfm, self-hosted in this site.',
    bfmMobileBlockedTitle: 'Desktop required',
    bfmMobileUnsupported:
      'Perceptive BFM needs a desktop browser with WebGL and SharedArrayBuffer. Open this page on a computer to use the embedded demo.',
    resizeControlWidth: 'Resize control panel width (left edge)',
    resizeControlHeight: 'Resize control panel height (bottom edge)',
    resizeControlBoth: 'Resize control panel (bottom-left corner)',
    microduckDescription:
      'Microduck sim2sim policies sharing one 61D observation contract. Pick the behavior with the state-machine buttons below.',
    microduckStateMachine: 'Microduck state machine',
    microduckStateWalk: 'Walk',
    microduckStateWalkHint: 'Walking policy. Steer with WASD / QE or the velocity sliders.',
    microduckStateStand: 'Stand',
    microduckStateStandHint: 'Standing hold policy with an all-zero command.',
    microduckStateSitstand: 'Sit / Stand',
    microduckStateSitstandHint: 'Sit ↔ stand on one policy. Y or the button flips the posture flag.',
    microduckStateRoulade: 'Roulade',
    microduckStateRouladeHint: 'Forward roll. The state machine returns to Walk once the roll finishes.',
    microduckStateSwitchHint:
      'Switching states reloads the ONNX policy only — the robot and the scene stay loaded.',
    microduckHowToPlay: 'PC keyboard (Microduck)',
    microduckKeyForward: 'Walk forward',
    microduckKeyBackward: 'Walk backward',
    microduckKeyLeft: 'Strafe left',
    microduckKeyRight: 'Strafe right',
    microduckKeyRotateLeft: 'Turn in place left',
    microduckKeyRotateRight: 'Turn in place right',
    microduckKeySprint: 'Hold for maximum speed',
    microduckKeySit: 'Sit / stand (sitstand policy)',
    microduckKeyboardFocusHint: 'Click the demo view first, then use the keys. Sliders update while keys are held.',
    microduckSitAction: 'Sit down',
    microduckStandAction: 'Stand up',
    microduckSitHint: 'The same sitstand policy sits and stands.',
    microduckSource: 'Policies and MJCF from pollen-robotics/microduck and microduck_rl.'
  },
  zh: {
    mobileModeAlert: '移动端布局：控制面板停靠在底部，便于触控操作。',
    safariAlert: 'Safari 的内存限制较低，可能导致 WASM 崩溃。',
    panelTitle: '通用跟踪演示',
    expandControlPanel: '展开控制面板',
    collapseControlPanel: '收起控制面板',
    expand: '展开',
    collapse: '收起',
    trainingCode: '训练代码',
    policy: '策略',
    selectPolicy: '选择策略',
    compliance: '顺应性',
    threshold: '阈值',
    on: '开',
    off: '关',
    currentMotion: '当前动作',
    motionFinished: '动作“{name}”已结束。开始其他片段前，请先回到默认姿态。',
    backToDefaultPose: '回到默认姿态',
    motionLocked: '动作“{name}”仍在播放。请等待播放结束并回到默认姿态后再切换。',
    loadingMotionPresets: '正在加载动作预设...',
    useCustomizedMotions: '想使用自定义动作？',
    customMotions: '自定义动作',
    uploadMotionJson: '上传动作 JSON',
    motionUploadHelpRead: '阅读 ',
    motionUploadHelpLink: 'readme',
    motionUploadHelpInstructions: ' 了解如何从 GMR 创建动作 JSON 文件。',
    motionUploadHelpDetails: '每个文件应只包含一个片段（结构与 motions/default.json 一致）。文件名会作为动作名称（自动添加 [new] 前缀），重复名称会被忽略。',
    cameraFollow: '相机跟随',
    velocityX: 'X 方向速度',
    velocityY: 'Y 方向速度',
    yawRate: '偏航角速度',
    renderScale: '渲染倍率',
    groundReflection: '地面反射',
    simFreq: '仿真频率',
    reset: '重置',
    loadingSimulationTitle: '正在加载仿真环境',
    loadingSimulationBody: '正在加载 MuJoCo 和 ONNX 策略，请稍候',
    loadingErrorTitle: '仿真环境加载失败',
    runtimeError: '发生意外运行时错误，请刷新页面。',
    webAssemblyUnsupported: '当前浏览器不支持 WebAssembly。请使用较新版本的 Chrome、Edge 或 Firefox。',
    policyDescription: '已启用顺应性输入的跟踪策略。',
    customizedGroup: '自定义',
    demoNotReady: '演示尚未就绪，请等待加载完成。',
    addedMotions: '已添加 {count} 个动作',
    skippedDuplicates: '已跳过 {count} 个重复项',
    ignoredInvalid: '已忽略 {count} 个无效文件',
    noMotionsAdded: '没有添加任何动作。',
    knockdownTest: '击倒测试',
    knockdownTestHint: '在骨盆上沿水平面（XY）随机方向施加一次固定大小的强冲击，用于测试倒地起身。',
    ampKeyboardHowToPlay: 'PC 键盘（AMP）',
    ampKeyForward: '向前行走',
    ampKeyBackward: '向后行走',
    ampKeyLeft: '向左平移',
    ampKeyRight: '向右平移',
    ampKeyRotateLeft: '原地向左旋转',
    ampKeyRotateRight: '原地向右旋转',
    ampKeySprint: '按住时以最大速度',
    ampKeyKnockdown: '击倒测试',
    ampKeyboardFocusHint: '请先点击演示画面，再使用键盘。按住按键时滑块会同步显示当前速度。',
    ampJoystickGroup: 'AMP 移动控制',
    microduckJoystickGroup: 'Microduck 移动与状态控制',
    ampJoystickMove: '移动（上/下=前进/后退，左/右=原地转向）',
    ampJoystickStrafeLeft: '向左平移',
    ampJoystickStrafeRight: '向右平移',
    parkourJoystickGroup: '跑酷移动控制',
    parkourJoystickMove: '移动（上=前进，左/右=原地转向，无后退）',
    parkourJoystickPause: '暂停',
    parkourJoystickResetRun: '重置当前回合',
    ampPolicyDescription:
      '用于行走、跑步和起身行为的 AMP 策略。',
    parkourPolicyDescription:
      '感知型人形跑酷演示（内嵌）。用键盘驱动 G1 穿越地形障碍课程。',
    parkourHoldW:
      '在接近、攀爬、登顶和下降的整个过程中持续按住 W，直到重新回到地面。',
    parkourHowToPlay: '操作说明',
    parkourMoveForward: '前进',
    parkourTurnLeft: '左转',
    parkourTurnRight: '右转',
    parkourSpeed: '按住快速（松开恢复慢速）',
    parkourPause: '暂停',
    parkourResetRun: '重置当前回合',
    parkourClimbNote: '按住 W 时会自动触发攀爬。',
    parkourFocusHint: '请先点击演示画面，再使用键盘按键。',
    parkourKeyboardFocusHint: '可用 WASD 与 Shift 键盘控制；按住按键时摇杆会同步显示方向。',
    parkourSource: '内嵌自 php-parkour 的构建，已自托管在本站。',
    parkourDepthDiagnostic: '深度诊断',
    parkourDepthDiagnosticHint:
      '导出深度管线状态（iOS 回读、策略加载、预览亮度等）JSON，便于分析报错与排查问题。',
    parkourDepthDiagnosticTitle: '跑酷深度诊断',
    parkourDepthDiagnosticCopy: '复制报告',
    parkourDepthDiagnosticCopied: '已复制',
    parkourDepthDiagnosticClose: '关闭',
    parkourDepthDiagnosticHealthy: '深度预览与 GPU 回读数据看起来正常。',
    parkourReset: '重新开始',
    bfmPolicyDescription:
      '感知行为基础模型演示（内嵌）。在浏览器中切换动作参考并观察地形感知跟踪效果。',
    bfmDesktopHint:
      '地形与遥测数据已移至本控制面板；动作按钮仍保留在演示画面下方。',
    bfmModel: '机器人模型',
    bfmModelPmt: 'PMT-faithful',
    bfmModelLegacy: 'Legacy',
    bfmFps: '渲染 FPS',
    bfmSimTime: '仿真时间',
    bfmTerrain: '地形',
    bfmTerrainDifficulty: '难度',
    bfmTerrainSeed: '随机种子',
    bfmTerrainRandomize: '随机种子',
    bfmTerrainGenerate: '生成地形',
    bfmHowToPlay: '操作说明',
    bfmMoveForward: '前进',
    bfmMoveBackward: '后退',
    bfmStrafeLeft: '左平移',
    bfmStrafeRight: '右平移',
    bfmTurnLeft: '左转',
    bfmTurnRight: '右转',
    bfmStop: '停止 / 平衡',
    bfmPause: '暂停 / 继续',
    bfmReset: '重新开始',
    bfmResetSim: '重置仿真',
    bfmHeightScan: '切换高度扫描可视化',
    bfmFocusHint: '请先点击演示画面，再使用键盘或内嵌 HUD 中的动作按钮。',
    bfmSource: '内嵌自 acodedog.github.io/perceptive-bfm 的构建，已自托管在本站。',
    bfmMobileBlockedTitle: '需要桌面浏览器',
    bfmMobileUnsupported:
      'Perceptive BFM 需要支持 WebGL 与 SharedArrayBuffer 的桌面浏览器，请在电脑上打开本页面体验内嵌演示。',
    resizeControlWidth: '拖拽左边框调整控制面板宽度',
    resizeControlHeight: '拖拽下边框调整控制面板高度',
    resizeControlBoth: '拖拽左下角同时调整控制面板大小',
    microduckDescription:
      'Microduck sim2sim 策略，共享同一套 61 维观测合同。具体行为由下方的状态机按钮切换。',
    microduckStateMachine: 'Microduck 状态机',
    microduckStateWalk: '行走',
    microduckStateWalkHint: '行走策略。使用 WASD / QE 或速度滑块控制。',
    microduckStateStand: '站立',
    microduckStateStandHint: '全零指令的站立保持策略。',
    microduckStateSitstand: '坐下 / 站起',
    microduckStateSitstandHint: '同一个策略完成坐下与站起。按 Y 或按钮翻转姿态标志。',
    microduckStateRoulade: '前滚翻',
    microduckStateRouladeHint: '前滚翻（roulade）。滚完后状态机自动回到行走。',
    microduckStateSwitchHint: '切换状态只重载 ONNX 策略，机器人与场景不会重新加载。',
    microduckHowToPlay: 'PC 键盘（Microduck）',
    microduckKeyForward: '向前行走',
    microduckKeyBackward: '向后行走',
    microduckKeyLeft: '向左平移',
    microduckKeyRight: '向右平移',
    microduckKeyRotateLeft: '原地向左旋转',
    microduckKeyRotateRight: '原地向右旋转',
    microduckKeySprint: '按住时以最大速度',
    microduckKeySit: '坐下 / 站起（sitstand 策略）',
    microduckKeyboardFocusHint: '请先点击演示画面，再使用键盘。按住按键时滑块会同步显示当前速度。',
    microduckSitAction: '坐下',
    microduckStandAction: '站起',
    microduckSitHint: '同一个 sitstand 策略负责坐下和站起。',
    microduckSource: '策略与 MJCF 来自 pollen-robotics/microduck 与 microduck_rl。'
  }
};

export default {
  name: 'DemoPage',
  components: {
    ModelIOFlowchart,
    AmpMobileJoystick,
    ParkourMobileJoystick
  },
  props: {
    visualTheme: {
      type: String,
      default: 'light'
    },
    language: {
      type: String,
      default: 'en'
    }
  },
  data: () => ({
    showExternalSourceLinks,
    state: 0, // 0: loading, 1: running, -1: JS error, -2: wasm unsupported
    // Declared so the template (ModelIOFlowchart :demo) sees it from the first
    // render; the instance itself is markRaw'd to stay out of reactivity.
    demo: null,
    extra_error_message: '',
    keydown_listener: null,
    currentMotion: null,
    availableMotions: [],
    trackingState: {
      available: false,
      currentName: 'default',
      currentDone: true,
      refIdx: 0,
      refLen: 0,
      transitionLen: 0,
      motionLen: 0,
      inTransition: false,
      isDefault: true
    },
    trackingTimer: null,
    policies: [
      {
        value: 'g1-amp-walk-run-getup',
        title: 'G1 AMP Walk/Run/Getup',
        description: 'AMP policy trained for walk, run, and get-up behaviors.',
        descriptionKey: 'ampPolicyDescription',
        policyPath: './examples/checkpoints/g1/amp_policy_walk_run_getup.json',
        onnxPath: './examples/checkpoints/g1/walk_run_getup/model_60000.onnx',
        scenePath: 'g1_amp/scene_g1.xml'
      },
      {
        value: 'g1-parkour',
        title: 'G1 Perceptive Parkour',
        descriptionKey: 'parkourPolicyDescription',
        isExternalDemo: true,
        iframePath: 'parkour/dist-desktop/index.html'
      },
      {
        value: 'g1-tracking-latest',
        title: 'G1 Tracking',
        description: 'Tracking policy with compliance input enabled.',
        descriptionKey: 'policyDescription',
        policyPath: './examples/checkpoints/g1/tracking_policy_latest.json',
        onnxPath: './examples/checkpoints/g1/tracking/policy_latest.onnx',
        scenePath: 'g1_amp/g1_tracking.xml'
      },
      {
        value: 'g1-perceptive-bfm',
        title: 'G1 Perceptive BFM',
        descriptionKey: 'bfmPolicyDescription',
        isExternalDemo: true,
        desktopOnly: true,
        iframePath: 'perceptive-bfm/dist-desktop/index.html'
      },
      {
        value: MICRODUCK_POLICY_VALUE,
        title: 'Microduck',
        descriptionKey: 'microduckDescription',
        // 隐藏项：网址带 ?unlock=microduck 时才出现在下拉栏里。
        unlockCode: MICRODUCK_UNLOCK_CODE,
        policyPath: microduckDefaultPolicyPaths().policyPath,
        onnxPath: microduckDefaultPolicyPaths().onnxPath,
        scenePath: MICRODUCK_SCENE_PATH
      }
    ],
    unlockedPolicyCodes: resolveUnlockedPolicyCodes(),
    currentPolicy: 'g1-amp-walk-run-getup',
    policyLabel: '',
    policyLoadError: '',
    motionUploadFiles: [],
    motionUploadMessage: '',
    motionUploadType: 'success',
    showUploadOptions: false,
    cameraFollowEnabled: true,
    complianceEnabled: false,
    complianceThreshold: 10.0,
    cmdX: 0.0,
    cmdY: 0.0,
    cmdYaw: 0.0,
    ampKeysHeld: new Set(),
    ampShiftHeld: false,
    renderScale: 2.0,
    reflectionQuality: 2,
    simStepHz: 0,
    isSmallScreen: false,
    isMobileControlsCollapsed: false,
    showSmallScreenAlert: true,
    isSafari: false,
    showSafariAlert: true,
    resize_listener: null,
    vvp_listener: null,
    simulationLoadProgress: 0,
    controlPanelWidth: loadControlPanelSize().width,
    controlPanelHeight: loadControlPanelSize().height,
    controlPanelResize: null,
    parkourHostTeardown: false,
    parkourLoading: false,
    parkourLoadProgress: 0,
    parkourReceivedProgress: false,
    parkourReloadKey: 0,
    parkourVirtualKeys: { w: false, a: false, d: false, highSpeed: false },
    parkourKeysHeld: new Set(),
    parkourShiftHeld: false,
    parkourDepthDiagnosticLoading: false,
    parkourDepthDiagnosticOpen: false,
    parkourDepthDiagnosticReport: null,
    parkourDepthDiagnosticText: '',
    parkourDepthDiagnosticCopied: false,
    parkourFrameMounted: false,
    bfmFps: null,
    bfmSimTime: null,
    bfmModel: 'pmt',
    bfmTerrainDifficulty: 0.4,
    bfmTerrainSeed: 1,
    policyBeforeChange: 'g1-amp-walk-run-getup',
    policyChangeGeneration: 0,
    pendingHostTeardown: null,
    microduckSitMode: false,
    microduckReturnTimer: null,
    microduckState: MICRODUCK_DEFAULT_STATE,
    microduckStateSwitching: false
  }),
  computed: {
    desktopControlsPanelStyle() {
      if (this.isSmallScreen) {
        return null;
      }
      if (this.isMobileControlsCollapsed) {
        return {
          width: `${this.controlPanelWidth}px`,
          height: 'auto'
        };
      }
      return {
        width: `${this.controlPanelWidth}px`,
        height: `${this.controlPanelHeight}px`
      };
    },
    shouldShowProgress() {
      const state = this.trackingState;
      if (!state || !state.available) {
        return false;
      }
      if (state.refLen > 1) {
        return true;
      }
      return !state.currentDone || !state.isDefault || state.inTransition;
    },
    progressValue() {
      const state = this.trackingState;
      if (!state || state.refLen <= 0) {
        return 0;
      }
      const value = ((state.refIdx + 1) / state.refLen) * 100;
      return Math.max(0, Math.min(100, value));
    },
    showBackToDefault() {
      const state = this.trackingState;
      return state && state.available && !state.isDefault && state.currentDone;
    },
    showMotionLockedNotice() {
      const state = this.trackingState;
      return state && state.available && !state.isDefault && !state.currentDone;
    },
    showMotionSelect() {
      const state = this.trackingState;
      if (!state || !state.available) {
        return false;
      }
      if (!state.isDefault || !state.currentDone) {
        return false;
      }
      return this.motionItems.some((item) => !item.disabled);
    },
    motionItems() {
      const names = [...this.availableMotions].sort((a, b) => {
        if (a === 'default') {
          return -1;
        }
        if (b === 'default') {
          return 1;
        }
        return a.localeCompare(b);
      });
      return names.map((name) => ({
        title: name.split('_')[0],
        value: name,
        disabled: this.isMotionDisabled(name)
      }));
    },
    motionGroups() {
      const items = this.motionItems.filter((item) => item.value !== 'default');
      if (items.length === 0) {
        return [];
      }
      const customized = [];
      const amass = [];
      const gentleHumanoid = [];
      const lafan = [];

      for (const item of items) {
        const value = item.value.toLowerCase();
        if (/(^|[_\s-])gentle$/.test(value)) {
          gentleHumanoid.push(item);
        } else if (value.includes('[new]')) {
          customized.push(item);
        } else if (value.includes('amass')) {
          amass.push(item);
        } else {
          lafan.push(item);
        }
      }

      const groups = [];
      if (lafan.length > 0) {
        groups.push({ title: 'LAFAN1', items: lafan });
      }
      if (amass.length > 0) {
        groups.push({ title: 'AMASS', items: amass });
      }
      if (gentleHumanoid.length > 0) {
        groups.push({ title: 'GentleHumanoid', items: gentleHumanoid });
      }
      if (customized.length > 0) {
        groups.push({ title: this.t.customizedGroup, items: customized });
      }
      return groups;
    },
    policyItems() {
      return this.policies
        .filter((policy) => !(policy.desktopOnly && isBfmDesktopRequired()))
        .filter((policy) => isPolicyUnlocked(policy, this.unlockedPolicyCodes))
        .map((policy) => ({
          title: policy.title,
          value: policy.value
        }));
    },
    selectedPolicy() {
      return this.policies.find((policy) => policy.value === this.currentPolicy) ?? null;
    },
    isAmpPolicy() {
      return this.currentPolicy?.startsWith('g1-amp');
    },
    isMicroduckPolicy() {
      return this.currentPolicy === MICRODUCK_POLICY_VALUE;
    },
    microduckStateItems() {
      return MICRODUCK_STATES.map((state) => ({
        value: state.value,
        icon: state.icon,
        title: this.t[state.labelKey] ?? state.value,
        active: this.microduckState === state.value
      }));
    },
    activeMicroduckState() {
      return this.isMicroduckPolicy ? microduckStateOrDefault(this.microduckState) : null;
    },
    microduckStateHint() {
      const state = this.activeMicroduckState;
      return state ? this.t[state.hintKey] ?? '' : '';
    },
    isMicroduckWalk() {
      return this.activeMicroduckState?.commandMode === 'velocity';
    },
    isMicroduckSitstand() {
      return this.activeMicroduckState?.commandMode === 'sitstand';
    },
    isVelocityCommandPolicy() {
      return this.isAmpPolicy || this.isMicroduckWalk;
    },
    isTrackingPolicy() {
      return !this.isAmpPolicy && !this.isExternalDemoPolicy && !this.isMicroduckPolicy;
    },
    velocityLimits() {
      return this.isMicroduckWalk ? MICRODUCK_CMD_LIMITS : AMP_CMD_LIMITS;
    },
    velocitySliderStep() {
      return this.isMicroduckWalk ? 0.05 : 0.1;
    },
    // Microduck 复用同一个摇杆：行走状态推杆，其它状态只留状态机按钮。
    showMobileJoystick() {
      return (this.isAmpPolicy || this.isMicroduckPolicy) && !this.isExternalDemoPolicy;
    },
    joystickProfile() {
      return this.isMicroduckPolicy ? MICRODUCK_JOYSTICK_PROFILE : AMP_JOYSTICK_PROFILE;
    },
    microduckJoystickStates() {
      if (!this.isMicroduckPolicy) {
        return [];
      }
      return this.microduckStateItems.map((item) => ({
        ...item,
        label: item.value === 'sitstand' && this.isMicroduckSitstand
          ? (this.microduckSitMode ? this.t.microduckStandAction : this.t.microduckSitAction)
          : item.title
      }));
    },
    showParkourJoystick() {
      return this.isParkourPolicy && this.parkourFrameMounted;
    },
    ampJoystickLabels() {
      return {
        group: this.isMicroduckPolicy ? this.t.microduckJoystickGroup : this.t.ampJoystickGroup,
        move: this.t.ampJoystickMove,
        strafeLeft: this.t.ampJoystickStrafeLeft,
        strafeRight: this.t.ampJoystickStrafeRight,
        knockdown: this.t.knockdownTest
      };
    },
    parkourJoystickLabels() {
      return {
        group: this.t.parkourJoystickGroup,
        move: this.t.parkourJoystickMove,
        pause: this.t.parkourJoystickPause,
        resetRun: this.t.parkourJoystickResetRun
      };
    },
    isExternalDemoPolicy() {
      return this.selectedPolicy?.isExternalDemo === true;
    },
    isParkourPolicy() {
      return this.currentPolicy === 'g1-parkour';
    },
    isBfmPolicy() {
      return this.currentPolicy === 'g1-perceptive-bfm';
    },
    showBfmMobileBlocked() {
      return this.isBfmPolicy && isBfmDesktopRequired();
    },
    showEmbeddedDemoFrame() {
      return this.isExternalDemoPolicy
        && this.parkourFrameMounted
        && !this.showBfmMobileBlocked;
    },
    embeddedDemoFrameTitle() {
      return this.selectedPolicy?.title ?? 'Embedded demo';
    },
    parkourIframeSrc() {
      const base = import.meta.env.BASE_URL || '/';
      const path = this.selectedPolicy?.iframePath ?? '';
      let url = `${base}${path}`;
      if (this.isBfmPolicy) {
        const sep = url.includes('?') ? '&' : '?';
        url += `${sep}model=${encodeURIComponent(this.bfmModel)}`;
      }
      return url;
    },
    parkourDepthDiagnosticHintLines() {
      const report = this.parkourDepthDiagnosticReport;
      if (!report?.hints?.length) {
        return [];
      }
      return report.hints.map((key) => report.hintLabels?.[key] ?? key);
    },
    parkourDepthDiagnosticSummary() {
      const report = this.parkourDepthDiagnosticReport;
      if (!report) {
        return null;
      }
      if (!report.hints.length) {
        return { type: 'success', text: this.t.parkourDepthDiagnosticHealthy };
      }
      const firstHint = report.hintLabels?.[report.hints[0]] ?? report.hints[0];
      return { type: 'warning', text: firstHint };
    },
    parkourControls() {
      return [
        { key: 'W', label: this.t.parkourMoveForward },
        { key: 'A', label: this.t.parkourTurnLeft },
        { key: 'D', label: this.t.parkourTurnRight },
        { key: 'SHIFT', label: this.t.parkourSpeed },
        { key: 'SPACE', label: this.t.parkourPause },
        { key: 'BACKSPACE', label: this.t.parkourResetRun }
      ];
    },
    bfmControls() {
      return [
        { key: 'W / S', label: `${this.t.bfmMoveForward} / ${this.t.bfmMoveBackward}` },
        { key: 'A / D', label: `${this.t.bfmStrafeLeft} / ${this.t.bfmStrafeRight}` },
        { key: 'Q / E', label: `${this.t.bfmTurnLeft} / ${this.t.bfmTurnRight}` },
        { key: 'X', label: this.t.bfmStop },
        { key: 'SPACE', label: this.t.bfmPause },
        { key: 'R', label: this.t.bfmResetSim },
        { key: 'H', label: this.t.bfmHeightScan }
      ];
    },
    bfmFpsLabel() {
      if (this.bfmFps == null || !Number.isFinite(this.bfmFps)) {
        return '—';
      }
      return `${this.bfmFps} FPS`;
    },
    bfmSimTimeLabel() {
      if (this.bfmSimTime == null || !Number.isFinite(this.bfmSimTime)) {
        return '—';
      }
      return `t = ${this.bfmSimTime.toFixed(2)}s`;
    },
    ampKeyboardControls() {
      return AMP_KEYBOARD_CONTROL_ROWS.map((row) => ({
        key: row.key,
        label: this.t[row.labelKey] ?? row.labelKey
      }));
    },
    microduckKeyboardControls() {
      return MICRODUCK_KEYBOARD_CONTROL_ROWS
        .filter((row) => {
          if (this.isMicroduckSitstand) {
            return row.key === 'Y';
          }
          if (this.isMicroduckWalk) {
            return row.key !== 'Y';
          }
          return false;
        })
        .map((row) => ({
          key: row.key,
          label: this.t[row.labelKey] ?? row.labelKey
        }));
    },
    policyDescription() {
      if (!this.selectedPolicy) {
        return '';
      }
      return this.selectedPolicy.descriptionKey
        ? this.t[this.selectedPolicy.descriptionKey]
        : this.selectedPolicy.description ?? '';
    },
    renderScaleLabel() {
      return `${this.renderScale.toFixed(2)}x`;
    },
    reflectionQualityLabel() {
      const sizes = [128, 192, 256, 384, 512];
      const idx = Math.max(0, Math.min(4, Math.round(this.reflectionQuality)));
      return `${sizes[idx]} px`;
    },
    complianceThresholdLabel() {
      return this.complianceThreshold.toFixed(1);
    },
    simStepLabel() {
      if (!this.simStepHz || !Number.isFinite(this.simStepHz)) {
        return '—';
      }
      return `${this.simStepHz.toFixed(1)} Hz`;
    },
    t() {
      return translations[this.language] ?? translations.en;
    },
    showSimulationLoadingDialog() {
      return this.state === 0 || this.parkourLoading;
    },
    simulationLoadingProgress() {
      return this.parkourLoading ? this.parkourLoadProgress : this.simulationLoadProgress;
    }
  },
  watch: {
    visualTheme: {
      immediate: true,
      handler(value) {
        this.demo?.setVisualTheme?.(value);
        if (this.isParkourPolicy) {
          this.postParkourHostControl({ visualTheme: value });
        }
      }
    }
  },
  methods: {
    detectSafari() {
      const ua = navigator.userAgent;
      return /Safari\//.test(ua)
        && !/Chrome\//.test(ua)
        && !/Chromium\//.test(ua)
        && !/Edg\//.test(ua)
        && !/OPR\//.test(ua)
        && !/SamsungBrowser\//.test(ua)
        && !/CriOS\//.test(ua)
        && !/FxiOS\//.test(ua);
    },
    updateScreenState() {
      const isSmall = window.innerWidth < 500 || window.innerHeight < 700;
      if (!isSmall && this.isSmallScreen) {
        this.showSmallScreenAlert = true;
      }
      if (isSmall !== this.isSmallScreen) {
        this.isMobileControlsCollapsed = isSmall;
        this.syncParkourHostControls();
      }
      this.isSmallScreen = isSmall;
      this.$nextTick(() => this.syncMobileControlsHeightObserver());
    },
    updateVisualViewportOffset() {
      if (!window.visualViewport) return;
      const vvp = window.visualViewport;
      // 布局视口底部与可视视口底部之间的差值，即浏览器底部工具栏高度
      const offset = Math.max(0, window.innerHeight - (vvp.offsetTop + vvp.height));
      document.documentElement.style.setProperty('--vvp-offset-bottom', `${offset}px`);
      this.updateMobileControlsHeight();
    },
    updateMobileControlsHeight() {
      if (!this.isSmallScreen) {
        document.documentElement.style.removeProperty('--mobile-controls-panel-height');
        return;
      }
      const panel = this.$refs.mobileControlsPanel;
      if (!panel) {
        return;
      }
      const height = Math.ceil(panel.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--mobile-controls-panel-height', `${height}px`);
      if (this.isParkourPolicy) {
        this.syncParkourHostControls();
      }
    },
    syncMobileControlsHeightObserver() {
      if (!this.mobileControlsResizeObserver) {
        return;
      }
      this.mobileControlsResizeObserver.disconnect();
      if (!this.isSmallScreen) {
        document.documentElement.style.removeProperty('--mobile-controls-panel-height');
        return;
      }
      const panel = this.$refs.mobileControlsPanel;
      if (panel) {
        this.mobileControlsResizeObserver.observe(panel);
        this.updateMobileControlsHeight();
      }
    },
    toggleMobileControls() {
      this.isMobileControlsCollapsed = !this.isMobileControlsCollapsed;
      this.$nextTick(() => {
        this.updateMobileControlsHeight();
        if (this.isParkourPolicy) {
          this.syncParkourHostControls();
        }
      });
    },
    formatMessage(template, values = {}) {
      return Object.entries(values).reduce(
        (message, [key, value]) => message.replaceAll(`{${key}}`, value),
        template
      );
    },
    formatCount(template, count) {
      return this.formatMessage(template, {
        count,
        plural: count === 1 ? '' : 's'
      });
    },
    setSimulationLoadProgress(ratio) {
      this.simulationLoadProgress = Math.round(Math.min(100, Math.max(0, ratio * 100)));
    },
    async runWithSimulationLoading(task) {
      const previousState = this.state;
      this.state = 0;
      this.simulationLoadProgress = 0;
      try {
        await task((ratio) => this.setSimulationLoadProgress(ratio));
        this.state = 1;
      } catch (error) {
        if (previousState === 1) {
          this.state = 1;
        } else {
          this.state = -1;
          // Fail securely: do not expose error.message to the user to prevent leaking sensitive system information.
          this.extra_error_message = 'An unexpected error occurred';
          console.error('Simulation load failed:', error);
        }
        throw error;
      }
    },
    async init() {
      if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') {
        this.state = -2;
        return;
      }

      try {
        const iosBootPolicy = isAppleMobileDevice() ? consumeIosBootPolicy() : null;
        if (iosBootPolicy === 'g1-parkour') {
          await this.bootExternalDemoOnlyOnIos(iosBootPolicy);
          return;
        }

        const bootHostPolicy = iosBootPolicy
          ? this.policies.find(
            (policy) =>
              policy.value === iosBootPolicy &&
              !policy.isExternalDemo &&
              isPolicyUnlocked(policy, this.unlockedPolicyCodes)
          )
          : null;
        const defaultPolicy = this.policies.find((policy) => policy.value === 'g1-amp-walk-run-getup');
        const selected = bootHostPolicy ?? defaultPolicy;
        await this.runWithSimulationLoading((report) => this.initHostDemo(selected, report));
        this.parkourHostTeardown = false;
        this.currentPolicy = selected.value;
        this.policyBeforeChange = selected.value;
      } catch (error) {
        console.error(error);
      }
    },
    async bootExternalDemoOnlyOnIos(policyValue) {
      this.currentPolicy = policyValue;
      this.policyBeforeChange = policyValue;
      this.parkourHostTeardown = true;
      this.state = 1;
      await this.mountParkourFrameAfterTeardown(this.policyChangeGeneration);
      this.startParkourLoad();
    },
    isStalePolicyChange(generation) {
      return generation !== this.policyChangeGeneration;
    },
    async waitForPendingHostTeardown() {
      if (!this.pendingHostTeardown) {
        return;
      }
      try {
        await this.pendingHostTeardown;
      } catch (error) {
        console.error('Host demo teardown failed:', error);
      }
    },
    async mountParkourFrameAfterTeardown(generation) {
      this.parkourFrameMounted = false;
      const teardown = this.teardownHostDemoForParkour();
      this.pendingHostTeardown = teardown;
      await teardown;
      this.pendingHostTeardown = null;
      if (this.isStalePolicyChange(generation)) {
        return;
      }
      if (isAppleMobileDevice()) {
        await new Promise((resolve) => setTimeout(resolve, PARKOUR_IOS_MOUNT_DELAY_MS));
      }
      if (this.isStalePolicyChange(generation)) {
        return;
      }
      this.parkourFrameMounted = true;
    },
    async initHostDemo(selected, report) {
      if (!selected || selected.isExternalDemo) {
        throw new Error('initHostDemo requires a MuJoCo policy');
      }
      report(0.02);
      const [{ MuJoCoDemo }, { default: loadMujoco }] = await Promise.all([
        import('@/simulation/main.js'),
        import('@/simulation/loadMujoco.js')
      ]);
      const mujoco = await loadMujoco();
      report(0.10);
      this.demo = markRaw(new MuJoCoDemo(mujoco));
      this.demo.setVisualTheme?.(this.visualTheme);
      this.demo.setFollowEnabled?.(this.cameraFollowEnabled);
      const scenePath = selected.scenePath ?? 'g1_amp/scene_g1.xml';
      await this.demo.switchSceneAndPolicy(scenePath, selected.policyPath, {
        onnxPath: selected.onnxPath || undefined,
        onProgress: (ratio) => {
          report(0.10 + 0.90 * ratio);
        }
      });
      report(1);
      this.demo.main_loop();
      this.demo.params.paused = false;
      this.syncHostDemoUiState(selected);
    },
    syncHostDemoUiState(selected) {
      if (selected.value === MICRODUCK_POLICY_VALUE) {
        this.warmMicroduckStateModels();
      }
      this.reapplyCustomMotions();
      this.availableMotions = this.getAvailableMotions();
      this.currentMotion = this.demo.params.current_motion ?? this.availableMotions[0] ?? null;
      this.complianceEnabled = Boolean(this.demo.params?.compliance_enabled);
      const threshold = Number(this.demo.params?.compliance_threshold);
      if (Number.isFinite(threshold)) {
        this.complianceThreshold = threshold;
      }
      this.startTrackingPoll();
      this.renderScale = this.demo.renderScale ?? this.renderScale;
      this.reflectionQuality = this.demo.reflectionQuality ?? this.reflectionQuality;
      this.policyLabel = selected.policyPath?.split('/').pop() ?? this.policyLabel;
    },
    async teardownHostDemoForParkour() {
      this.stopTrackingPoll();
      this.clearAmpKeyboardState();
      this.customMotions = {};
      this.motionUploadFiles = [];
      this.motionUploadMessage = '';
      this.availableMotions = [];
      this.currentMotion = null;
      if (!this.demo) {
        this.parkourHostTeardown = true;
        return;
      }
      try {
        await this.demo.dispose();
      } catch (error) {
        console.error('Failed to tear down host MuJoCo demo for Parkour:', error);
      }
      this.demo = null;
      document.getElementById('mujoco-container')?.replaceChildren();
      this.parkourHostTeardown = true;
      this.simStepHz = 0;
      this.trackingState = {
        available: false,
        currentName: 'default',
        currentDone: true,
        refIdx: 0,
        refLen: 0,
        transitionLen: 0,
        motionLen: 0,
        inTransition: false,
        isDefault: true
      };
    },
    reapplyCustomMotions() {
      if (!this.demo || !this.customMotions) {
        return;
      }
      const names = Object.keys(this.customMotions);
      if (names.length === 0) {
        return;
      }
      this.addMotions(this.customMotions);
    },
    async onMotionUpload(files) {
      const fileList = Array.isArray(files)
        ? files
        : files instanceof FileList
          ? Array.from(files)
          : files
            ? [files]
            : [];
      if (fileList.length === 0) {
        return;
      }
      if (!this.demo) {
        this.motionUploadMessage = this.t.demoNotReady;
        this.motionUploadType = 'warning';
        this.motionUploadFiles = [];
        return;
      }

      let added = 0;
      let skipped = 0;
      let invalid = 0;
      let failed = 0;
      const prefix = '[new] ';

      for (const file of fileList) {
        try {
          // Add a 5MB size limit check to prevent Uncontrolled Resource Consumption (DoS)
          // parsing large JSON files could block the UI thread or cause OOM
          if (file.size > 5 * 1024 * 1024) {
            console.warn(`File ${file.name} exceeds 5MB limit, skipping.`);
            failed += 1;
            continue;
          }
          const text = await file.text();
          const parsed = JSON.parse(text);
          const clip = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
          if (!clip) {
            invalid += 1;
            continue;
          }

          const baseName = file.name.replace(/\.[^/.]+$/, '').trim();
          const normalizedName = baseName ? baseName : 'motion';
          const motionName = normalizedName.startsWith(prefix)
            ? normalizedName
            : `${prefix}${normalizedName}`;
          const result = this.addMotions({ [motionName]: clip });
          added += result.added.length;
          skipped += result.skipped.length;
          invalid += result.invalid.length;

          if (result.added.length > 0) {
            if (!this.customMotions) {
              this.customMotions = {};
            }
            for (const name of result.added) {
              this.customMotions[name] = clip;
            }
          }
        } catch (error) {
          console.error('Failed to read motion JSON:', error);
          failed += 1;
        }
      }

      if (added > 0) {
        this.availableMotions = this.getAvailableMotions();
      }

      const parts = [];
      if (added > 0) {
        parts.push(this.formatCount(this.t.addedMotions, added));
      }
      if (skipped > 0) {
        parts.push(this.formatCount(this.t.skippedDuplicates, skipped));
      }
      const badCount = invalid + failed;
      if (badCount > 0) {
        parts.push(this.formatCount(this.t.ignoredInvalid, badCount));
      }
      if (parts.length === 0) {
        this.motionUploadMessage = this.t.noMotionsAdded;
        this.motionUploadType = 'info';
      } else {
        this.motionUploadMessage = `${parts.join('. ')}.`;
        this.motionUploadType = badCount > 0 ? 'warning' : 'success';
      }
      this.motionUploadFiles = [];
    },
    toggleCameraFollow() {
      this.cameraFollowEnabled = !this.cameraFollowEnabled;
      if (this.isParkourPolicy) {
        this.postParkourHostControl({ cameraFollow: this.cameraFollowEnabled });
        return;
      }
      if (this.demo?.setFollowEnabled) {
        this.demo.setFollowEnabled(this.cameraFollowEnabled);
      }
    },
    postParkourHostControl(partial) {
      const win = this.$refs.parkourFrame?.contentWindow;
      if (!win) {
        return;
      }
      try {
        win.postMessage(
          {
            source: 'parkour-host-control',
            type: 'apply',
            ...partial
          },
          window.location.origin
        );
      } catch (error) {
        /* iframe may not be ready */
      }
    },
    postBfmHostControl(partial) {
      const win = this.$refs.parkourFrame?.contentWindow;
      if (!win) {
        return;
      }
      try {
        win.postMessage(
          {
            source: 'bfm-host-control',
            ...partial
          },
          window.location.origin
        );
      } catch (error) {
        /* iframe may not be ready */
      }
    },
    loadBfmTerrainConfig() {
      try {
        const saved = JSON.parse(localStorage.getItem('bfm-terrain') || 'null');
        if (!saved || typeof saved !== 'object') {
          return;
        }
        if (Number.isFinite(Number(saved.difficulty))) {
          this.bfmTerrainDifficulty = Number(saved.difficulty);
        }
        if (Number.isFinite(Number(saved.seed))) {
          this.bfmTerrainSeed = Number(saved.seed);
        }
      } catch {
        /* ignore malformed storage */
      }
    },
    loadBfmModelConfig() {
      try {
        const saved = localStorage.getItem('bfm-model');
        if (saved === 'pmt' || saved === 'legacy') {
          this.bfmModel = saved;
        }
      } catch {
        /* storage may be unavailable */
      }
    },
    onBfmModelChange(model) {
      if (this.bfmModel === model) {
        return;
      }
      this.bfmModel = model;
      try {
        localStorage.setItem('bfm-model', model);
      } catch {
        /* storage may be unavailable */
      }
      if (!this.isBfmPolicy) {
        return;
      }
      this.startParkourLoad();
      this.parkourReloadKey += 1;
    },
    resetBfmTelemetry() {
      this.bfmFps = null;
      this.bfmSimTime = null;
    },
    bfmTerrainRandomize() {
      const cryptoRandom = typeof window !== 'undefined' && window.crypto
        ? window.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
        : Math.random();
      this.bfmTerrainSeed = Math.floor(cryptoRandom * 1e9) + 1;
    },
    bfmTerrainGenerate() {
      const cfg = {
        difficulty: this.bfmTerrainDifficulty,
        seed: this.bfmTerrainSeed
      };
      try {
        localStorage.setItem('bfm-terrain', JSON.stringify(cfg));
      } catch {
        /* storage may be unavailable */
      }
      this.postBfmHostControl({
        type: 'terrainGenerate',
        difficulty: cfg.difficulty,
        seed: cfg.seed
      });
    },
    syncParkourHostControls() {
      if (!this.isParkourPolicy) {
        return;
      }
      this.postParkourHostControl({
        cameraFollow: this.cameraFollowEnabled,
        renderScale: this.renderScale,
        reflectionQuality: this.reflectionQuality,
        visualTheme: this.visualTheme,
        ...this.getParkourDepthPreviewLayout()
      });
    },
    getParkourDepthPreviewLayout() {
      const scale = this.isSmallScreen ? 2 : 4;
      const cornerRadiusPx = this.getControlsPanelCornerRadiusPx();
      if (!this.isSmallScreen) {
        const inset = 16;
        return {
          depthPreviewScale: scale,
          depthPreviewMargin: inset,
          depthPreviewLeftOffset: inset,
          depthPreviewBottomOffset: inset,
          depthPreviewCornerRadiusPx: cornerRadiusPx
        };
      }

      const panel = this.$refs.mobileControlsPanel;
      const padEl = this.$refs.parkourJoystick?.$el;
      const stickBase = this.$refs.parkourJoystick?.$refs?.moveBase;
      if (panel && padEl && stickBase) {
        const viewportHeight = window.innerHeight;
        const panelRect = panel.getBoundingClientRect();
        const panelTopFromBottom = viewportHeight - panelRect.top;
        const stickRect = stickBase.getBoundingClientRect();
        const joystickCenterFromBottom = viewportHeight - (stickRect.top + stickRect.height / 2);
        const joystickPadLeft = padEl.getBoundingClientRect().left;
        const leftOffset = Math.round(panelRect.left);
        return {
          ...computeParkourMobileDepthLayoutWithClearance({
            panelTopFromBottom,
            joystickCenterFromBottom,
            joystickPadLeft,
            preferredScale: scale,
            leftOffset
          }),
          depthPreviewCornerRadiusPx: cornerRadiusPx
        };
      }

      const panelHeight = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--mobile-controls-panel-height')
      ) || 56;
      const bottomInset = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--vvp-offset-bottom')
      ) || 0;
      return {
        ...computeParkourMobileDepthLayoutFromMetrics({
          panelHeight,
          bottomInset,
          previewScale: scale,
          viewportWidth: window.innerWidth
        }),
        depthPreviewCornerRadiusPx: cornerRadiusPx
      };
    },
    getControlsPanelCornerRadiusPx() {
      const card = this.$refs.mobileControlsPanel?.querySelector('.controls-card');
      if (!card) {
        return this.isSmallScreen ? 18 : 4;
      }
      const radius = parseFloat(getComputedStyle(card).borderTopLeftRadius);
      if (Number.isFinite(radius) && radius > 0) {
        return radius;
      }
      return this.isSmallScreen ? 18 : 4;
    },
    clearParkourVirtualInput() {
      this.parkourVirtualKeys = { w: false, a: false, d: false, highSpeed: false };
      this.postParkourHostControl({
        virtualInput: { active: false, w: false, a: false, d: false, highSpeed: false }
      });
    },
    async runParkourDepthDiagnostic() {
      if (!this.isParkourPolicy || this.state !== 1 || this.parkourLoading) {
        return;
      }

      this.parkourDepthDiagnosticLoading = true;
      this.parkourDepthDiagnosticCopied = false;

      try {
        const demo = this.$refs.parkourFrame?.contentWindow?.__parkourDemo ?? null;
        const bundleStatus = await fetchParkourBundleIosPatchStatus(this.parkourIframeSrc);
        const report = buildParkourDepthDiagnosticReport({
          demo,
          host: {
            url: window.location.href,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            maxTouchPoints: navigator.maxTouchPoints,
            parkourLoading: this.parkourLoading,
            isSmallScreen: this.isSmallScreen
          },
          bundleHasIosPatch: bundleStatus.hasIosPatch,
          bundleUrl: bundleStatus.bundleUrl
        });

        if (bundleStatus.error) {
          report.bundle.error = bundleStatus.error;
        }

        this.parkourDepthDiagnosticReport = report;
        this.parkourDepthDiagnosticText = formatParkourDepthDiagnosticReport(report);
        this.parkourDepthDiagnosticOpen = true;
        await this.copyParkourDepthDiagnostic({ silent: true });
      } finally {
        this.parkourDepthDiagnosticLoading = false;
      }
    },
    async copyParkourDepthDiagnostic({ silent = false } = {}) {
      const text = this.parkourDepthDiagnosticText;
      if (!text) {
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        if (!silent) {
          this.parkourDepthDiagnosticCopied = true;
          window.setTimeout(() => {
            this.parkourDepthDiagnosticCopied = false;
          }, 2000);
        }
      } catch {
        if (!silent) {
          this.parkourDepthDiagnosticCopied = false;
        }
      }
    },
    onParkourJoystickInput({ active, w, a, d, highSpeed }) {
      if (!this.isParkourPolicy || this.state !== 1 || this.parkourLoading) {
        return;
      }
      if (this.parkourKeysHeld.size > 0) {
        this.applyParkourKeyboardCommand();
        return;
      }
      this.parkourVirtualKeys = {
        w: Boolean(w),
        a: Boolean(a),
        d: Boolean(d),
        highSpeed: Boolean(highSpeed)
      };
      this.postParkourHostControl({
        virtualInput: {
          active: Boolean(active),
          w: Boolean(w),
          a: Boolean(a),
          d: Boolean(d),
          highSpeed: Boolean(highSpeed)
        }
      });
    },
    onParkourPause() {
      if (!this.isParkourPolicy || this.state !== 1 || this.parkourLoading) {
        return;
      }
      this.postParkourHostControl({ parkourPause: 'toggle' });
    },
    onParkourResetRun() {
      if (!this.isParkourPolicy || this.state !== 1 || this.parkourLoading) {
        return;
      }
      this.clearParkourKeyboardState();
      this.clearParkourVirtualInput();
      this.postParkourHostControl({ parkourResetRun: true });
    },
    clearParkourKeyboardState() {
      this.parkourKeysHeld.clear();
      this.parkourShiftHeld = false;
    },
    applyParkourKeyboardCommand() {
      if (!this.isParkourPolicy || this.state !== 1 || this.isSmallScreen) {
        return;
      }
      const input = parkourVirtualKeysFromKeyboard(this.parkourKeysHeld, this.parkourShiftHeld);
      this.parkourVirtualKeys = {
        w: input.w,
        a: input.a,
        d: input.d,
        highSpeed: input.highSpeed
      };
      this.postParkourHostControl({ virtualInput: input });
    },
    handleParkourKeyDown(event) {
      if (!this.isParkourPolicy || this.state !== 1 || this.isSmallScreen || this.shouldIgnoreAmpKeyboard(event)) {
        return;
      }
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        this.parkourShiftHeld = event.getModifierState('Shift');
        this.applyParkourKeyboardCommand();
        return;
      }
      if (isParkourResetKey(event.code)) {
        if (event.repeat) {
          return;
        }
        event.preventDefault();
        this.onParkourResetRun();
        return;
      }
      if (isParkourPauseKey(event.code)) {
        if (event.repeat) {
          return;
        }
        event.preventDefault();
        this.onParkourPause();
        return;
      }
      if (!isParkourMovementKey(event.code)) {
        return;
      }
      if (event.repeat && this.parkourKeysHeld.has(event.code)) {
        return;
      }
      event.preventDefault();
      this.parkourKeysHeld.add(event.code);
      this.applyParkourKeyboardCommand();
    },
    handleParkourKeyUp(event) {
      if (!this.isParkourPolicy || this.isSmallScreen) {
        return;
      }
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        this.parkourShiftHeld = event.getModifierState('Shift');
        this.applyParkourKeyboardCommand();
        return;
      }
      if (!isParkourMovementKey(event.code)) {
        return;
      }
      event.preventDefault();
      this.parkourKeysHeld.delete(event.code);
      this.applyParkourKeyboardCommand();
    },
    onParkourKeyboardBlur() {
      if (!this.isParkourPolicy) {
        return;
      }
      this.clearParkourKeyboardState();
      this.applyParkourKeyboardCommand();
    },
    onParkourKeyboardSync(data) {
      if (!this.isParkourPolicy || this.state !== 1 || this.isSmallScreen) {
        return;
      }
      if (data.type === 'clear') {
        this.clearParkourKeyboardState();
        this.applyParkourKeyboardCommand();
        return;
      }
      const codes = Array.isArray(data.keysHeld) ? data.keysHeld : [];
      this.parkourKeysHeld = new Set(codes.filter((code) => isParkourMovementKey(code)));
      this.parkourShiftHeld = Boolean(data.shiftHeld);
      this.applyParkourKeyboardCommand();
    },
    toggleCompliance() {
      const nextEnabled = !this.complianceEnabled;
      if (nextEnabled) {
        const current = this.currentMotion ?? this.demo?.params?.current_motion;
        if (current && !this.isMotionComplianceSuitable(current)) {
          return;
        }
      }
      this.complianceEnabled = nextEnabled;
      this.applyComplianceSettings();
    },

    onCmdChange() {
      if (!this.demo) {
        return;
      }
      this.demo.params.cmdX = this.cmdX;
      this.demo.params.cmdY = this.cmdY;
      this.demo.params.cmdYaw = this.cmdYaw;
    },
    onAmpJoystickCommand({ cmdX, cmdY, cmdYaw }) {
      if (!(this.isAmpPolicy || this.isMicroduckWalk) || this.state !== 1) {
        return;
      }
      this.cmdX = cmdX;
      this.cmdY = cmdY;
      this.cmdYaw = cmdYaw;
      this.onCmdChange();
      // 键盘仍按住时以键盘指令为准，避免摇杆回中把 WASD 覆盖掉。
      if (this.ampKeysHeld.size > 0) {
        if (this.isMicroduckWalk) {
          this.applyMicroduckKeyboardCommand();
        } else {
          this.applyAmpKeyboardCommand();
        }
      }
    },
    shouldIgnoreAmpKeyboard(event) {
      return shouldIgnoreAmpKeyboardTarget(event.target);
    },
    clearAmpKeyboardState() {
      this.ampKeysHeld.clear();
      this.ampShiftHeld = false;
    },
    applyAmpKeyboardCommand() {
      if (!this.isAmpPolicy || this.state !== 1) {
        return;
      }
      const { cmdX, cmdY, cmdYaw } = computeAmpCommandFromKeys(
        this.ampKeysHeld,
        this.ampShiftHeld
      );
      this.cmdX = cmdX;
      this.cmdY = cmdY;
      this.cmdYaw = cmdYaw;
      this.onCmdChange();
    },
    handleAmpKeyDown(event) {
      if (!this.isAmpPolicy || this.state !== 1 || this.shouldIgnoreAmpKeyboard(event)) {
        return;
      }
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        this.ampShiftHeld = event.getModifierState('Shift');
        this.applyAmpKeyboardCommand();
        return;
      }
      if (isAmpKnockdownKey(event.code)) {
        if (event.repeat) {
          return;
        }
        event.preventDefault();
        this.onKnockdownTest();
        this.$refs.ampJoystick?.pulseKnockdown?.();
        return;
      }
      if (!isAmpMovementKey(event.code)) {
        return;
      }
      if (event.repeat && this.ampKeysHeld.has(event.code)) {
        return;
      }
      event.preventDefault();
      this.ampKeysHeld.add(event.code);
      this.applyAmpKeyboardCommand();
    },
    handleAmpKeyUp(event) {
      if (!this.isAmpPolicy) {
        return;
      }
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        this.ampShiftHeld = event.getModifierState('Shift');
        this.applyAmpKeyboardCommand();
        return;
      }
      if (!isAmpMovementKey(event.code)) {
        return;
      }
      event.preventDefault();
      this.ampKeysHeld.delete(event.code);
      this.applyAmpKeyboardCommand();
    },
    onAmpKeyboardBlur() {
      if (!this.isAmpPolicy) {
        return;
      }
      this.clearAmpKeyboardState();
      this.applyAmpKeyboardCommand();
    },
    onKnockdownTest() {
      if (!this.demo || this.state !== 1) {
        return;
      }
      this.demo.queueKnockdownDisturbance();
    },
    onComplianceThresholdChange(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return;
      }
      this.complianceThreshold = numeric;
      this.applyComplianceSettings();
    },
    applyComplianceSettings() {
      if (!this.demo?.params) {
        return;
      }
      this.demo.params.compliance_enabled = Boolean(this.complianceEnabled);
      this.demo.params.compliance_threshold = Number(this.complianceThreshold);
    },
    isMotionComplianceSuitable(name) {
      const tracking = this.demo?.policyRunner?.tracking ?? null;
      if (!tracking || typeof tracking.isComplianceSuitable !== 'function') {
        return true;
      }
      return tracking.isComplianceSuitable(name);
    },
    isMotionDisabled(name) {
      if (name === 'default') {
        return true;
      }
      if (!this.complianceEnabled) {
        return false;
      }
      return !this.isMotionComplianceSuitable(name);
    },
    async onMotionChange(value) {
      if (!this.demo) {
        return;
      }
      if (!value || value === this.demo.params.current_motion) {
        this.currentMotion = this.demo.params.current_motion ?? value;
        return;
      }
      const tracking = this.demo?.policyRunner?.tracking ?? null;
      if (tracking?.ensureMotionLoaded) {
        try {
          const loaded = await tracking.ensureMotionLoaded(value);
          if (!loaded) {
            this.currentMotion = this.demo.params.current_motion;
            return;
          }
        } catch (error) {
          console.error('Failed to load motion:', error);
          this.currentMotion = this.demo.params.current_motion;
          return;
        }
      }
      const accepted = this.requestMotion(value);
      if (!accepted) {
        this.currentMotion = this.demo.params.current_motion;
      } else {
        this.currentMotion = value;
        this.updateTrackingState();
      }
    },
    async onPolicyChange(value) {
      if (!value) {
        return;
      }
      const selected = this.policies.find((policy) => policy.value === value);
      if (!selected || !isPolicyUnlocked(selected, this.unlockedPolicyCodes)) {
        return;
      }
      const generation = ++this.policyChangeGeneration;
      const previousPolicy = this.policies.find((policy) => policy.value === this.policyBeforeChange);
      try {
      if (!value?.startsWith('g1-amp') && value !== MICRODUCK_POLICY_VALUE) {
        this.clearAmpKeyboardState();
      }
      this.clearMicroduckReturnTimer();
      this.microduckSitMode = false;
      this.microduckStateSwitching = false;
      // 重新选中 Microduck 时统一从默认状态（行走）进入，后续由状态机按钮切换。
      this.microduckState = MICRODUCK_DEFAULT_STATE;
      if (!selected?.isExternalDemo) {
        this.clearParkourKeyboardState();
      }
      if (selected.isExternalDemo) {
        if (selected.desktopOnly && isBfmDesktopRequired()) {
          this.policyLoadError = this.t.bfmMobileUnsupported;
          this.$nextTick(() => {
            this.currentPolicy = this.policyBeforeChange;
          });
          return;
        }
        // iOS: reload the same page so only the embedded demo iframe stack is loaded.
        if (isAppleMobileDevice()) {
          scheduleIosPolicyBoot(value);
          return;
        }
        // Entering an embedded demo: fully release host MuJoCo/ONNX/WebGL so the iframe
        // is the only WASM + WebGL stack in the tab.
        this.policyLoadError = '';
        if (value === 'g1-perceptive-bfm') {
          this.loadBfmModelConfig();
        }
        try {
          await this.mountParkourFrameAfterTeardown(generation);
          if (this.isStalePolicyChange(generation)) {
            return;
          }
          this.startParkourLoad();
        } catch (error) {
          if (this.isStalePolicyChange(generation)) {
            return;
          }
          console.error('Failed to enter Parkour:', error);
          this.parkourFrameMounted = false;
          this.policyLoadError = 'An unexpected error occurred';
        }
        return;
      }
      this.parkourFrameMounted = false;
      await this.waitForPendingHostTeardown();
      if (this.isStalePolicyChange(generation)) {
        return;
      }
      if (previousPolicy?.isExternalDemo && isAppleMobileDevice()) {
        scheduleIosPolicyBoot(value);
        return;
      }
      // Leaving Parkour: cold-start the host demo for the selected MuJoCo policy.
      if (this.parkourHostTeardown) {
        this.clearParkourVirtualInput();
        this.policyLoadError = '';
        try {
          await this.runWithSimulationLoading((report) => this.initHostDemo(selected, report));
          if (this.isStalePolicyChange(generation)) {
            return;
          }
          this.parkourHostTeardown = false;
          if (this.isAmpPolicy || this.isMicroduckPolicy) {
            this.resetAmpCommandSliders();
          }
        } catch (error) {
          if (this.isStalePolicyChange(generation)) {
            return;
          }
          console.error('Failed to restore host MuJoCo demo after Parkour:', error);
          this.policyLoadError = 'An unexpected error occurred';
        }
        return;
      }
      if (!this.demo) {
        return;
      }
      const targetScenePath = selected.scenePath ?? 'g1_amp/scene_g1.xml';
      const needsReload = selected.policyPath !== this.demo.currentPolicyPath
        || selected.onnxPath
        || targetScenePath !== this.demo.currentScenePath;
      if (!needsReload) {
        return;
      }
      const wasPaused = this.demo.params?.paused ?? false;
      this.demo.params.paused = true;
      this.policyLoadError = '';
      try {
        await this.runWithSimulationLoading((report) =>
          this.demo.switchSceneAndPolicy(targetScenePath, selected.policyPath, {
            onnxPath: selected.onnxPath || undefined,
            onProgress: report
          })
        );
        if (this.isStalePolicyChange(generation)) {
          return;
        }
        if (this.isAmpPolicy || this.isMicroduckPolicy) {
          this.resetAmpCommandSliders();
        }
        if (this.isMicroduckPolicy) {
          this.warmMicroduckStateModels();
        }
        this.policyLabel = selected.policyPath?.split('/').pop() ?? this.policyLabel;
        this.reapplyCustomMotions();
        this.availableMotions = this.getAvailableMotions();
        this.currentMotion = this.demo.params.current_motion ?? this.availableMotions[0] ?? null;
        this.updateTrackingState();
      } catch (error) {
        if (this.isStalePolicyChange(generation)) {
          return;
        }
        console.error('Failed to reload policy:', error);
        this.policyLoadError = 'An unexpected error occurred';
      } finally {
        if (!this.isStalePolicyChange(generation) && this.demo) {
          this.demo.params.paused = wasPaused;
        }
      }
      } finally {
        if (!this.isStalePolicyChange(generation)) {
          this.policyBeforeChange = value;
        }
      }
    },
    resetAmpCommandSliders() {
      this.clearAmpKeyboardState();
      this.cmdX = 0.0;
      this.cmdY = 0.0;
      this.cmdYaw = 0.0;
      this.onCmdChange();
    },
    clearMicroduckReturnTimer() {
      if (this.microduckReturnTimer != null) {
        clearTimeout(this.microduckReturnTimer);
        this.microduckReturnTimer = null;
      }
    },
    // 瞬态状态（roulade）按仿真时间计时：暂停或掉帧时不会提前切回。
    scheduleMicroduckReturn(state) {
      this.clearMicroduckReturnTimer();
      if (!state?.autoNext || !state.autoNextSimSeconds || !this.demo) {
        return;
      }
      const generation = this.policyChangeGeneration;
      const startStep = this.demo.policyRunner?.stepCount ?? 0;
      const stepSeconds = (this.demo.timestep ?? 0.002) * (this.demo.decimation ?? 1);
      const targetSteps = Math.max(1, Math.round(state.autoNextSimSeconds / stepSeconds));
      const poll = () => {
        this.microduckReturnTimer = null;
        if (this.isStalePolicyChange(generation) || this.microduckState !== state.value) {
          return;
        }
        const elapsedSteps = (this.demo?.policyRunner?.stepCount ?? startStep) - startStep;
        if (elapsedSteps >= targetSteps) {
          this.switchMicroduckState(state.autoNext);
          return;
        }
        this.microduckReturnTimer = setTimeout(poll, MICRODUCK_AUTO_NEXT_POLL_MS);
      };
      this.microduckReturnTimer = setTimeout(poll, MICRODUCK_AUTO_NEXT_POLL_MS);
    },
    // 下拉项悬停/聚焦时预取该策略的场景网格与 ONNX，点击切换时多半已就绪。
    schedulePolicyPrefetch(value) {
      this.cancelPolicyPrefetch();
      this.policyPrefetchTimer = setTimeout(() => {
        this.policyPrefetchTimer = null;
        this.prefetchPolicy(value);
      }, POLICY_PREFETCH_DELAY_MS);
    },
    cancelPolicyPrefetch() {
      clearTimeout(this.policyPrefetchTimer);
      this.policyPrefetchTimer = null;
    },
    prefetchPolicy(value) {
      const policy = this.policies.find((item) => item.value === value);
      if (!policy || policy.isExternalDemo || value === this.currentPolicy || this.state !== 1) {
        return;
      }
      this.demo?.prefetchSceneAndPolicy(policy.scenePath, policy.policyPath, policy.onnxPath);
    },
    // 进入 Microduck 后在后台预热其余状态的策略与 ONNX session，状态机切换时直接复用。
    warmMicroduckStateModels() {
      for (const state of MICRODUCK_STATES) {
        if (state.value !== this.microduckState) {
          this.demo?.prefetchSceneAndPolicy(MICRODUCK_SCENE_PATH, state.policyPath, state.onnxPath);
        }
      }
    },
    // 状态机按钮：同一个 Microduck 下拉项内热切换策略，只重载 ONNX，不重载机器人网格。
    async switchMicroduckState(value) {
      const target = findMicroduckState(value);
      if (!target || !this.isMicroduckPolicy || !this.demo) {
        return;
      }
      if (this.microduckStateSwitching || this.state !== 1) {
        return;
      }
      if (this.microduckState === value && this.demo.currentPolicyPath === target.policyPath) {
        return;
      }
      const generation = ++this.policyChangeGeneration;
      const previousState = this.microduckState;
      this.clearMicroduckReturnTimer();
      this.microduckStateSwitching = true;
      this.microduckState = value;
      this.microduckSitMode = false;
      this.resetAmpCommandSliders();
      const wasPaused = this.demo.params?.paused ?? false;
      this.demo.params.paused = true;
      this.policyLoadError = '';
      try {
        await this.runWithSimulationLoading((report) =>
          this.demo.switchSceneAndPolicy(MICRODUCK_SCENE_PATH, target.policyPath, {
            onnxPath: target.onnxPath,
            onProgress: report
          })
        );
        if (this.isStalePolicyChange(generation)) {
          return;
        }
        this.resetAmpCommandSliders();
        this.policyLabel = target.policyPath.split('/').pop() ?? this.policyLabel;
        this.scheduleMicroduckReturn(target);
      } catch (error) {
        if (this.isStalePolicyChange(generation)) {
          return;
        }
        console.error('Failed to switch Microduck state:', error);
        this.microduckState = previousState;
        this.policyLoadError = 'An unexpected error occurred';
      } finally {
        if (!this.isStalePolicyChange(generation)) {
          this.microduckStateSwitching = false;
          if (this.demo) {
            this.demo.params.paused = wasPaused;
          }
        }
      }
    },
    // 摇杆旁的状态机按钮：再次点击当前的坐下/站起状态即翻转姿态。
    onMicroduckJoystickState(value) {
      if (value === 'sitstand' && this.isMicroduckSitstand) {
        this.toggleMicroduckSit();
        return;
      }
      this.switchMicroduckState(value);
    },
    toggleMicroduckSit() {
      if (!this.isMicroduckSitstand || this.state !== 1) {
        return;
      }
      this.microduckSitMode = !this.microduckSitMode;
      this.cmdX = this.microduckSitMode ? 1.0 : 0.0;
      this.cmdY = 0.0;
      this.cmdYaw = 0.0;
      this.onCmdChange();
    },
    applyMicroduckKeyboardCommand() {
      if (!this.isMicroduckWalk || this.state !== 1) {
        return;
      }
      const { cmdX, cmdY, cmdYaw } = computeMicroduckCommandFromKeys(
        this.ampKeysHeld,
        this.ampShiftHeld
      );
      this.cmdX = cmdX;
      this.cmdY = cmdY;
      this.cmdYaw = cmdYaw;
      this.onCmdChange();
    },
    handleMicroduckKeyDown(event) {
      if (!this.isMicroduckPolicy || this.state !== 1 || this.shouldIgnoreAmpKeyboard(event)) {
        return;
      }
      if (this.isMicroduckSitstand && isMicroduckSitKey(event.code)) {
        if (event.repeat) {
          return;
        }
        event.preventDefault();
        this.toggleMicroduckSit();
        return;
      }
      if (!this.isMicroduckWalk) {
        return;
      }
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        this.ampShiftHeld = event.getModifierState('Shift');
        this.applyMicroduckKeyboardCommand();
        return;
      }
      if (!isMicroduckMovementKey(event.code)) {
        return;
      }
      if (event.repeat && this.ampKeysHeld.has(event.code)) {
        return;
      }
      event.preventDefault();
      this.ampKeysHeld.add(event.code);
      this.applyMicroduckKeyboardCommand();
    },
    handleMicroduckKeyUp(event) {
      if (!this.isMicroduckWalk) {
        return;
      }
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        this.ampShiftHeld = event.getModifierState('Shift');
        this.applyMicroduckKeyboardCommand();
        return;
      }
      if (!isMicroduckMovementKey(event.code)) {
        return;
      }
      event.preventDefault();
      this.ampKeysHeld.delete(event.code);
      this.applyMicroduckKeyboardCommand();
    },
    onMicroduckKeyboardBlur() {
      if (!this.isMicroduckWalk) {
        return;
      }
      this.clearAmpKeyboardState();
      this.applyMicroduckKeyboardCommand();
    },
    reset() {
      if (this.isExternalDemoPolicy) {
        if (this.isParkourPolicy) {
          this.clearParkourVirtualInput();
        }
        // Reload the embedded demo for a clean restart (remounts via :key).
        this.startParkourLoad();
        this.parkourReloadKey += 1;
        return;
      }
      if (!this.demo) {
        return;
      }
      if (this.isAmpPolicy || this.isMicroduckPolicy) {
        this.resetAmpCommandSliders();
      }
      if (this.isMicroduckSitstand) {
        this.microduckSitMode = false;
      }
      this.demo.resetSimulation();
      this.availableMotions = this.getAvailableMotions();
      this.currentMotion = this.demo.params.current_motion ?? this.availableMotions[0] ?? null;
      this.updateTrackingState();
    },
    startParkourLoad() {
      this.clearParkourLoadTimers();
      this.parkourLoading = true;
      this.parkourLoadProgress = 0;
      this.parkourReceivedProgress = false;
      this.simStepHz = 0;
      if (this.isBfmPolicy) {
        this.loadBfmTerrainConfig();
        this.loadBfmModelConfig();
        this.resetBfmTelemetry();
      }
    },
    clearParkourLoadTimers() {
      if (this.parkourFallbackTimer) {
        clearTimeout(this.parkourFallbackTimer);
        this.parkourFallbackTimer = null;
      }
      if (this.parkourHardTimer) {
        clearTimeout(this.parkourHardTimer);
        this.parkourHardTimer = null;
      }
    },
    focusParkourFrame() {
      // Desktop: keep focus on the host page so document key listeners drive
      // virtualInput and the joystick knob stays in sync. Mobile uses touch only.
      try {
        if (this.isSmallScreen) {
          this.$refs.parkourFrame?.contentWindow?.focus();
        } else {
          window.focus();
        }
      } catch (error) {
        /* focusing can throw in some browsers; safe to ignore */
      }
    },
    finishParkourLoading() {
      this.clearParkourLoadTimers();
      this.parkourLoadProgress = 100;
      this.parkourLoading = false;
      this.$nextTick(() => {
        this.updateMobileControlsHeight();
        this.syncParkourHostControls();
        if (this.isBfmPolicy) {
          this.postBfmHostControl({ type: 'getStats' });
        }
        this.focusParkourFrame();
      });
    },
    handleParkourMessage(event) {
      const frame = this.$refs.parkourFrame;
      if (!frame || event.source !== frame.contentWindow) {
        return;
      }
      if (event.origin !== window.location.origin) {
        return;
      }
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return;
      }
      if (data.source === 'parkour-host') {
        if (data.type === 'stats') {
          const hz = Number(data.simStepHz);
          if (Number.isFinite(hz)) {
            this.simStepHz = hz;
          }
        }
        return;
      }
      if (data.source === 'bfm-host') {
        if (data.type === 'stats') {
          const fps = Number(data.fps);
          if (Number.isFinite(fps)) {
            this.bfmFps = fps;
            this.simStepHz = fps;
          }
          const simTime = Number(data.simTime);
          if (Number.isFinite(simTime)) {
            this.bfmSimTime = simTime;
          }
          const terrain = data.terrainConfig;
          if (terrain && typeof terrain === 'object') {
            if (Number.isFinite(Number(terrain.difficulty))) {
              this.bfmTerrainDifficulty = Number(terrain.difficulty);
            }
            if (Number.isFinite(Number(terrain.seed))) {
              this.bfmTerrainSeed = Number(terrain.seed);
            }
          }
        }
        return;
      }
      if (data.source === 'parkour-keyboard-sync') {
        this.onParkourKeyboardSync(data);
        return;
      }
      if (data.source !== 'parkour-loader') {
        return;
      }
      if (data.type === 'progress') {
        this.parkourReceivedProgress = true;
        const value = Number(data.value);
        if (Number.isFinite(value)) {
          const pct = Math.round(Math.min(100, Math.max(0, value * 100)));
          // Monotonic: a fresh load resets parkourLoadProgress to 0 first.
          if (pct > this.parkourLoadProgress) {
            this.parkourLoadProgress = pct;
          }
        }
      } else if (data.type === 'ready') {
        this.finishParkourLoading();
      }
    },
    onParkourLoad() {
      // The iframe's HTML document loaded, but the heavy MuJoCo + ONNX assets
      // are still downloading/initialising inside it. Keep the overlay until the
      // embedded reporter posts 'ready' (scene painted); the timers below guard
      // against the reporter being unavailable so we never hang on the loader.
      this.clearParkourLoadTimers();
      if (!this.parkourLoading) {
        this.focusParkourFrame();
        return;
      }
      // If no progress arrives shortly, assume the reporter is missing and
      // reveal the demo instead of waiting indefinitely.
      this.parkourFallbackTimer = setTimeout(() => {
        if (this.parkourLoading && !this.parkourReceivedProgress) {
          this.finishParkourLoading();
        }
      }, 8000);
      // Absolute cap so we never stay on the loader for a pathological load.
      this.parkourHardTimer = setTimeout(() => {
        if (this.parkourLoading) {
          this.finishParkourLoading();
        }
      }, 180000);
    },
    backToDefault() {
      if (!this.demo) {
        return;
      }
      const accepted = this.requestMotion('default');
      if (accepted) {
        this.currentMotion = 'default';
        this.updateTrackingState();
      }
    },
    startTrackingPoll() {
      this.stopTrackingPoll();
      this.updateTrackingState();
      this.updatePerformanceStats();
      this.trackingTimer = setInterval(() => {
        this.updateTrackingState();
        this.updatePerformanceStats();
      }, 33);
    },
    stopTrackingPoll() {
      if (this.trackingTimer) {
        clearInterval(this.trackingTimer);
        this.trackingTimer = null;
      }
    },
    updateTrackingState() {
      const tracking = this.demo?.policyRunner?.tracking ?? null;
      if (!tracking) {
        this.trackingState = {
          available: false,
          currentName: 'default',
          currentDone: true,
          refIdx: 0,
          refLen: 0,
          transitionLen: 0,
          motionLen: 0,
          inTransition: false,
          isDefault: true
        };
        return;
      }
      const state = tracking.playbackState();
      this.trackingState = { ...state };
      this.availableMotions = tracking.availableMotions();
      const current = this.demo.params.current_motion ?? state.currentName ?? null;
      if (current && this.currentMotion !== current) {
        this.currentMotion = current;
      }
    },
    updatePerformanceStats() {
      if (this.isExternalDemoPolicy) {
        return;
      }
      if (!this.demo) {
        this.simStepHz = 0;
        return;
      }
      this.simStepHz = this.demo.getSimStepHz?.() ?? this.demo.simStepHz ?? 0;
    },
    onRenderScaleChange(value) {
      if (this.isParkourPolicy) {
        this.postParkourHostControl({ renderScale: value });
        return;
      }
      if (!this.demo) {
        return;
      }
      this.demo.setRenderScale(value);
    },
    onReflectionQualityChange(value) {
      if (this.isParkourPolicy) {
        this.postParkourHostControl({ reflectionQuality: value });
        return;
      }
      if (!this.demo) {
        return;
      }
      this.demo.setReflectionQuality(value);
    },
    getAvailableMotions() {
      const tracking = this.demo?.policyRunner?.tracking ?? null;
      return tracking ? tracking.availableMotions() : [];
    },
    addMotions(motions, options = {}) {
      const tracking = this.demo?.policyRunner?.tracking ?? null;
      if (!tracking) {
        return { added: [], skipped: [], invalid: [] };
      }
      return tracking.addMotions(motions, options);
    },
    requestMotion(name) {
      const tracking = this.demo?.policyRunner?.tracking ?? null;
      if (!tracking || !this.demo) {
        return false;
      }
      const state = this.demo.readPolicyState();
      const accepted = tracking.requestMotion(name, state);
      if (accepted) {
        this.demo.params.current_motion = name;
      }
      return accepted;
    },
    clampControlPanelToViewport() {
      if (this.isSmallScreen) {
        return;
      }
      const next = clampControlPanelSize(this.controlPanelWidth, this.controlPanelHeight);
      this.controlPanelWidth = next.width;
      this.controlPanelHeight = next.height;
    },
    startControlPanelResize(edge, event) {
      if (this.isSmallScreen) {
        return;
      }
      this.controlPanelResize = {
        edge,
        startX: event.clientX,
        startY: event.clientY,
        startW: this.controlPanelWidth,
        startH: this.controlPanelHeight
      };
      document.addEventListener('mousemove', this._onControlPanelResizeMove);
      document.addEventListener('mouseup', this._onControlPanelResizeEnd);
      document.body.classList.add('controls-panel-resizing');
    },
    onControlPanelResizeMove(event) {
      if (!this.controlPanelResize) {
        return;
      }
      const dx = event.clientX - this.controlPanelResize.startX;
      const dy = event.clientY - this.controlPanelResize.startY;
      let w = this.controlPanelResize.startW;
      let h = this.controlPanelResize.startH;
      const { edge } = this.controlPanelResize;
      if (edge.includes('w')) {
        w -= dx;
      }
      if (edge.includes('s')) {
        h += dy;
      }
      const clamped = clampControlPanelSize(w, h);
      this.controlPanelWidth = clamped.width;
      this.controlPanelHeight = clamped.height;
      const cursor =
        edge === 'w' ? 'ew-resize' : edge === 's' ? 'ns-resize' : 'nesw-resize';
      document.body.style.cursor = cursor;
    },
    endControlPanelResize() {
      if (!this.controlPanelResize) {
        return;
      }
      this.controlPanelResize = null;
      document.removeEventListener('mousemove', this._onControlPanelResizeMove);
      document.removeEventListener('mouseup', this._onControlPanelResizeEnd);
      document.body.classList.remove('controls-panel-resizing');
      document.body.style.cursor = '';
      saveControlPanelSize(this.controlPanelWidth, this.controlPanelHeight);
    }
  },
  mounted() {
    this.customMotions = {};
    this.parkourFallbackTimer = null;
    this.policyPrefetchTimer = null;
    this.parkourHardTimer = null;
    this.parkour_message_listener = (event) => this.handleParkourMessage(event);
    window.addEventListener('message', this.parkour_message_listener);
    this.isSafari = this.detectSafari();
    this.updateScreenState();
    this.updateVisualViewportOffset();
    this._onControlPanelResizeMove = (e) => this.onControlPanelResizeMove(e);
    this._onControlPanelResizeEnd = () => this.endControlPanelResize();
    this.resize_listener = () => {
      this.updateScreenState();
      this.updateVisualViewportOffset();
      this.clampControlPanelToViewport();
    };
    window.addEventListener('resize', this.resize_listener);
    if (window.visualViewport) {
      this.vvp_listener = () => {
        this.updateVisualViewportOffset();
      };
      window.visualViewport.addEventListener('resize', this.vvp_listener);
      window.visualViewport.addEventListener('scroll', this.vvp_listener);
    }
    this.policyBeforeChange = this.currentPolicy;
    this.init();
    this.keydown_listener = (event) => {
      this.handleParkourKeyDown(event);
      this.handleAmpKeyDown(event);
      this.handleMicroduckKeyDown(event);
      if (event.code === 'Backspace' && !this.isParkourPolicy) {
        this.reset();
      }
    };
    this.keyup_listener = (event) => {
      this.handleParkourKeyUp(event);
      this.handleAmpKeyUp(event);
      this.handleMicroduckKeyUp(event);
    };
    this.amp_blur_listener = () => {
      this.onAmpKeyboardBlur();
      this.onMicroduckKeyboardBlur();
      this.onParkourKeyboardBlur();
    };
    document.addEventListener('keydown', this.keydown_listener);
    document.addEventListener('keyup', this.keyup_listener);
    window.addEventListener('blur', this.amp_blur_listener);
    this.mobileControlsResizeObserver = new ResizeObserver(() => {
      this.updateMobileControlsHeight();
    });
    this.$watch(
      () => [this.isSmallScreen, this.isMobileControlsCollapsed],
      () => {
        this.$nextTick(() => this.syncMobileControlsHeightObserver());
      },
      { immediate: true }
    );
  },
  beforeUnmount() {
    this.endControlPanelResize();
    this.stopTrackingPoll();
    if (this.demo) {
      this.demo.dispose?.();
      this.demo = null;
    }
    this.clearMicroduckReturnTimer();
    this.clearParkourLoadTimers();
    this.cancelPolicyPrefetch();
    if (this.parkour_message_listener) {
      window.removeEventListener('message', this.parkour_message_listener);
    }
    this.mobileControlsResizeObserver?.disconnect();
    document.documentElement.style.removeProperty('--mobile-controls-panel-height');
    document.removeEventListener('keydown', this.keydown_listener);
    if (this.keyup_listener) {
      document.removeEventListener('keyup', this.keyup_listener);
    }
    if (this.amp_blur_listener) {
      window.removeEventListener('blur', this.amp_blur_listener);
    }
    if (this.resize_listener) {
      window.removeEventListener('resize', this.resize_listener);
    }
    if (this.vvp_listener && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.vvp_listener);
      window.visualViewport.removeEventListener('scroll', this.vvp_listener);
    }
  }
};
</script>

<style scoped>
.parkour-frame-wrap {
  position: fixed;
  top: var(--header-h, 56px);
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-embed);
  background: var(--bg);
}

.bfm-mobile-blocked {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 24px 32px;
}

.bfm-mobile-blocked-inner {
  max-width: 22rem;
  text-align: center;
  color: var(--text-muted);
}

.bfm-mobile-blocked-title {
  color: var(--text);
  font-size: 1.25rem;
  line-height: 1.75rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-bottom: 12px;
}

.bfm-mobile-blocked-text {
  font-size: 1rem;
  line-height: 1.5rem;
  margin: 0;
}

.parkour-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
.parkour-depth-diagnostic-hints {
  margin: 0;
  padding-left: 16px;
}

.parkour-depth-diagnostic-text :deep(textarea) {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1rem;
}

.parkour-controls {
  display: flex;
  flex-direction: column;
}

.bfm-terrain-seed-field {
  max-width: 8rem;
  flex: 1;
}

.parkour-keys {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 12px;
  align-items: center;
}

.microduck-state-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.microduck-state-grid .v-btn {
  min-width: 0;
  justify-content: flex-start;
}

.parkour-key {
  justify-self: start;
  min-width: 24px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16);
  border-bottom-width: 2px;
  border-radius: 6px;
  padding: 2px 8px;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1rem;
  text-align: center;
}

.controls {
  position: fixed;
  top: calc(var(--header-h, 56px) + 16px);
  right: 16px;
  z-index: var(--z-panel);
  border-radius: var(--radius);
}

.controls:focus {
  outline: none;
}

.controls:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.controls-mobile {
  top: auto;
  right: 12px;
  left: 12px;
  bottom: calc(12px + constant(safe-area-inset-bottom) + var(--vvp-offset-bottom, 0px));
  bottom: calc(12px + env(safe-area-inset-bottom, 0px) + var(--vvp-offset-bottom, 0px));
  width: auto;
  max-width: none;
}

.controls-mobile-collapsed {
  bottom: calc(12px + constant(safe-area-inset-bottom) + var(--vvp-offset-bottom, 0px));
  bottom: calc(12px + env(safe-area-inset-bottom, 0px) + var(--vvp-offset-bottom, 0px));
}

.global-alerts {
  position: fixed;
  top: calc(var(--header-h, 56px) + 16px);
  left: 16px;
  right: 16px;
  max-width: 520px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: var(--z-alerts);
}

/* 系统提示：中性表面 + 细边框，只让图标带语义色，避免整块饱和蓝。 */
.notice-alert {
  width: 100%;
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-md);
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.small-screen-alert :deep(.v-alert__prepend) {
  color: rgb(var(--v-theme-primary));
}

.safari-alert :deep(.v-alert__prepend) {
  color: rgb(var(--v-theme-warning));
}

.controls-card {
  max-height: calc(100dvh - 40px);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-md);
}

.controls-card-resizable {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: none;
}

.controls-card-resizable .controls-body {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
}

.controls-actions {
  flex-shrink: 0;
}

.controls-resize-handle {
  position: absolute;
  z-index: 3;
  touch-action: none;
}

.controls-resize-w {
  top: 18px;
  left: 0;
  width: 8px;
  bottom: 18px;
  cursor: ew-resize;
}

.controls-resize-s {
  left: 18px;
  right: 0;
  bottom: 0;
  height: 8px;
  cursor: ns-resize;
}

.controls-resize-sw {
  left: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nesw-resize;
  background: transparent;
}

.controls-resize-sw::before {
  content: '';
  position: absolute;
  left: 4px;
  bottom: 4px;
  width: 8px;
  height: 8px;
  border-left: 1.5px solid rgba(var(--v-theme-primary), 0.45);
  border-bottom: 1.5px solid rgba(var(--v-theme-primary), 0.45);
  border-bottom-left-radius: 4px;
  pointer-events: none;
  transition: border-color var(--transition);
}

.controls-resize-w:hover,
.controls-resize-w:active,
.controls-resize-s:hover,
.controls-resize-s:active {
  background-color: rgba(var(--v-theme-primary), 0.12);
}

.controls-resize-handle {
  transition: background-color var(--transition);
}

.controls-resize-sw:hover::before,
.controls-resize-sw:active::before {
  border-color: rgba(var(--v-theme-primary), 0.9);
}

.controls-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 8px;
}

.controls-title-mobile {
  padding-right: 12px;
}

.controls-toggle-btn {
  text-transform: none;
  letter-spacing: 0;
}

.controls-mobile .controls-card {
  max-height: min(52dvh, 420px);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
}

.controls-mobile-collapsed .controls-card {
  max-height: none;
}

.controls-body {
  max-height: calc(100dvh - 160px);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.training-links {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  margin: 0 -8px;
}

.training-links .v-btn,
.microduck-source-link {
  justify-content: flex-start;
  font-weight: 500;
}

.training-links :deep(.v-btn__content) {
  justify-content: flex-start;
}

.controls-mobile .controls-body {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  overflow-y: auto;
}

.controls-mobile :deep(.v-card-title) {
  font-size: 1rem;
  line-height: 1.5rem;
  padding: 12px 16px 8px;
  flex-shrink: 0;
}

/* v-card-text 与 .controls-body 是同一元素，占满剩余空间，内容纵向可滚动 */
.controls-mobile :deep(.v-card-text) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-left: 16px;
  padding-right: 16px;
}

/* Reset 按钮固定在卡片底部，不被压缩 */
.controls-mobile :deep(.v-card-actions) {
  flex-shrink: 0;
  padding: 8px 16px calc(14px + constant(safe-area-inset-bottom));
  padding: 8px 16px calc(14px + env(safe-area-inset-bottom, 0px));
}

.controls-mobile-collapsed :deep(.v-card-actions),
.controls-desktop-collapsed :deep(.v-card-actions) {
  display: none;
}

.controls-desktop-collapsed .controls-card-resizable {
  height: auto;
}

.controls-mobile :deep(.v-btn) {
  min-height: 32px;
}

.controls-mobile .motion-groups {
  max-height: 132px;
}

.motion-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.motion-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  max-height: 200px;
  overflow-y: auto;
}

.motion-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.motion-chip {
  text-transform: none;
  font-size: 0.75rem;
}

.status-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.status-name {
  font-weight: 600;
}

.policy-file {
  display: block;
  margin-top: 4px;
}


.upload-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upload-toggle {
  padding: 0;
  min-height: unset;
  font-size: 0.875rem;
  text-transform: none;
}

.motion-progress-no-animation,
.motion-progress-no-animation *,
.motion-progress-no-animation::before,
.motion-progress-no-animation::after {
  transition: none !important;
  animation: none !important;
}

.motion-progress-no-animation :deep(.v-progress-linear__determinate),
.motion-progress-no-animation :deep(.v-progress-linear__indeterminate),
.motion-progress-no-animation :deep(.v-progress-linear__background) {
  transition: none !important;
  animation: none !important;
}

.loading-simulation-progress,
.loading-simulation-progress *,
.loading-simulation-progress::before,
.loading-simulation-progress::after {
  transition: none !important;
  animation: none !important;
}

.loading-simulation-progress :deep(.v-progress-linear__determinate),
.loading-simulation-progress :deep(.v-progress-linear__background) {
  transition: none !important;
  animation: none !important;
}

@media (max-width: 640px), (max-height: 760px) {
  .global-alerts {
    top: calc(var(--header-h, 56px) + 12px);
    left: 12px;
    right: 12px;
  }
}
</style>

<style>
body.controls-panel-resizing {
  user-select: none;
}
</style>
