<template>
  <SportActivityAdmin v-if="store.isAdmin" />
  <SportActivity v-else />
</template>

<script setup>
import { useUserStore } from '../store/user';
import SportActivity from './SportActivity.vue';
import SportActivityAdmin from './SportActivityAdmin.vue';

const store = useUserStore();
</script>
